const crypto = require('crypto');

const TRON_USDT_ADDRESS = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const ETHEREUM_USDT_ADDRESS = '0xdac17f958d2ee523a2206206994597c13d831ec7';
const TRANSFER_TOPIC = 'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const TRON_SOLIDITY_URL = 'https://api.trongrid.io/walletsolidity/gettransactioninfobyid';
const TIMEOUT_MS = Math.max(1000, Number(process.env.CHAIN_REQUEST_TIMEOUT_MS || 10000));
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

class ChainProviderError extends Error {
  constructor(code) { super(code); this.code = code; }
}

function decodeTronAddress(address) {
  const text = String(address || '').trim();
  if (!text || [...text].some(char => !BASE58.includes(char))) throw new ChainProviderError('invalid_tron_address');
  let value = 0n;
  for (const char of text) value = value * 58n + BigInt(BASE58.indexOf(char));
  let hex = value.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  const leadingZeroes = (text.match(/^1+/) || [''])[0].length;
  const bytes = Buffer.concat([Buffer.alloc(leadingZeroes), Buffer.from(hex, 'hex')]);
  if (bytes.length !== 25) throw new ChainProviderError('invalid_tron_address');
  const payload = bytes.subarray(0, 21);
  const checksum = crypto.createHash('sha256').update(crypto.createHash('sha256').update(payload).digest()).digest().subarray(0, 4);
  if (!crypto.timingSafeEqual(checksum, bytes.subarray(21)) || payload[0] !== 0x41) throw new ChainProviderError('invalid_tron_address');
  return payload.subarray(1).toString('hex').toLowerCase();
}

function amountToUnits(amount) {
  const value = String(amount ?? '').trim();
  const match = value.match(/^(0|[1-9]\d*)(?:\.(\d{1,6}))?$/);
  if (!match) throw new ChainProviderError('invalid_usdt_amount');
  return BigInt(match[1]) * 1000000n + BigInt((match[2] || '').padEnd(6, '0') || '0');
}

async function postJson(url, payload, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    if (!response.ok) throw new ChainProviderError(`provider_http_${response.status}`);
    return await response.json();
  } catch (error) {
    if (error instanceof ChainProviderError) throw error;
    throw new ChainProviderError(error.name === 'AbortError' ? 'provider_timeout' : 'provider_unavailable');
  } finally {
    clearTimeout(timer);
  }
}

function result(status, reason, extra = {}) { return { status, reason, ...extra }; }

async function verifyTron({ txHash, recipient, amount }) {
  if (!/^[a-f0-9]{64}$/i.test(txHash)) return result('mismatch', 'invalid_tx_hash');
  const recipientHex = decodeTronAddress(recipient);
  const headers = process.env.TRONGRID_API_KEY ? { 'TRON-PRO-API-KEY': process.env.TRONGRID_API_KEY } : {};
  const info = await postJson(TRON_SOLIDITY_URL, { value: txHash }, headers);
  if (info.Error) throw new ChainProviderError('provider_response_error');
  if (!info.id) return result('pending', 'transaction_not_solidified');
  const execution = info.receipt?.result || info.result;
  if (execution && execution !== 'SUCCESS') return result('mismatch', 'transaction_failed');
  if (execution !== 'SUCCESS') return result('pending', 'execution_status_unavailable');

  const expectedAmount = amountToUnits(amount);
  const contractHex = decodeTronAddress(TRON_USDT_ADDRESS);
  const transfers = (Array.isArray(info.log) ? info.log : []).filter(log => {
    const contract = String(log.address || '').replace(/^0x/i, '').replace(/^41/i, '').toLowerCase();
    const topics = Array.isArray(log.topics) ? log.topics.map(x => String(x).replace(/^0x/i, '').toLowerCase()) : [];
    return contract === contractHex && topics[0] === TRANSFER_TOPIC && topics.length >= 3;
  }).map(log => {
    const topics = log.topics.map(x => String(x).replace(/^0x/i, '').toLowerCase());
    const rawAmount = String(log.data || '').replace(/^0x/i, '');
    return {
      fromHex: topics[1].slice(-40),
      toHex: topics[2].slice(-40),
      units: /^[a-f0-9]{64}$/i.test(rawAmount) ? BigInt(`0x${rawAmount}`) : -1n
    };
  });
  const transfer = transfers.find(x => x.toHex === recipientHex);
  if (!transfer) return result('mismatch', transfers.length ? 'recipient_mismatch' : 'usdt_transfer_not_found', { blockNumber: info.blockNumber });
  if (transfer.units !== expectedAmount) return result('mismatch', 'amount_mismatch', { blockNumber: info.blockNumber });
  return result('verified', 'confirmed_transfer', {
    network: 'TRC20', txHash: info.id, recipient, amount: String(amount),
    from: `41${transfer.fromHex}`, blockNumber: info.blockNumber, confirmed: true
  });
}

async function ethereumRpc(url, method, params) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) {
    throw new ChainProviderError('invalid_provider_url');
  }
  const data = await postJson(url, { jsonrpc: '2.0', id: 1, method, params });
  if (data.error || !Object.hasOwn(data, 'result')) throw new ChainProviderError('provider_response_error');
  return data.result;
}

async function verifyEthereum({ txHash, recipient, amount }) {
  if (!/^0x[a-f0-9]{64}$/i.test(txHash)) return result('mismatch', 'invalid_tx_hash');
  const rpcUrl = String(process.env.ETHEREUM_RPC_URL || '').trim();
  if (!rpcUrl) throw new ChainProviderError('ethereum_rpc_not_configured');
  const [chainId, receipt] = await Promise.all([
    ethereumRpc(rpcUrl, 'eth_chainId', []),
    ethereumRpc(rpcUrl, 'eth_getTransactionReceipt', [txHash])
  ]);
  if (String(chainId).toLowerCase() !== '0x1') return result('mismatch', 'wrong_chain');
  if (!receipt) return result('pending', 'transaction_not_mined');
  if (String(receipt.status).toLowerCase() !== '0x1') return result('mismatch', 'transaction_failed');
  const [finalizedBlock, expectedAmount] = await Promise.all([
    ethereumRpc(rpcUrl, 'eth_getBlockByNumber', ['finalized', false]),
    Promise.resolve(amountToUnits(amount))
  ]);
  if (!finalizedBlock?.number || BigInt(receipt.blockNumber) > BigInt(finalizedBlock.number)) {
    return result('pending', 'transaction_not_finalized', { blockNumber: receipt.blockNumber });
  }

  const normalizedRecipient = String(recipient || '').toLowerCase().replace(/^0x/, '').padStart(40, '0');
  const logs = Array.isArray(receipt.logs) ? receipt.logs : [];
  const transfers = logs.filter(log => {
    const topics = Array.isArray(log.topics) ? log.topics.map(x => String(x).replace(/^0x/i, '').toLowerCase()) : [];
    return String(log.address || '').toLowerCase() === ETHEREUM_USDT_ADDRESS.toLowerCase() && topics[0] === TRANSFER_TOPIC && topics.length >= 3;
  }).map(log => {
    const topics = log.topics.map(x => String(x).replace(/^0x/i, '').toLowerCase());
    const rawAmount = String(log.data || '').replace(/^0x/i, '');
    return {
      from: `0x${topics[1].slice(-40)}`,
      to: topics[2].slice(-40),
      units: /^[a-f0-9]{64}$/i.test(rawAmount) ? BigInt(`0x${rawAmount}`) : -1n
    };
  });
  const transfer = transfers.find(x => x.to === normalizedRecipient);
  if (!transfer) return result('mismatch', transfers.length ? 'recipient_mismatch' : 'usdt_transfer_not_found', { blockNumber: receipt.blockNumber });
  if (transfer.units !== expectedAmount) return result('mismatch', 'amount_mismatch', { blockNumber: receipt.blockNumber });
  return result('verified', 'confirmed_transfer', {
    network: 'ERC20', txHash: receipt.transactionHash, recipient, amount: String(amount),
    from: transfer.from, blockNumber: receipt.blockNumber, confirmed: true
  });
}

async function verifyUsdtTransfer({ network, txHash, recipient, amount }) {
  if (!['TRC20', 'ERC20'].includes(network)) return result('mismatch', 'invalid_network');
  if (!String(txHash || '').trim()) return result('mismatch', 'missing_tx_hash');
  if (!String(recipient || '').trim()) return result('mismatch', 'missing_recipient');
  try {
    return network === 'TRC20'
      ? await verifyTron({ txHash: String(txHash).trim(), recipient, amount })
      : await verifyEthereum({ txHash: String(txHash).trim(), recipient, amount });
  } catch (error) {
    return result('unavailable', error.code || 'provider_unavailable');
  }
}

module.exports = { verifyUsdtTransfer };
