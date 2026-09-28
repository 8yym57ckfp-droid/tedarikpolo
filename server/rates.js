const https = require('https');
const crypto = require('crypto');

let cache = { market: null, source: null, fetchedAt: 0, providers: [] };
const CACHE_MS = Number(process.env.RATE_CACHE_MS || 60000);
const MAX_STALE_MS = Number(process.env.RATE_MAX_STALE_MS || 300000);
const REQUEST_TIMEOUT_MS = Number(process.env.RATE_REQUEST_TIMEOUT_MS || 5000);

function fetchJson(url){
  return new Promise((resolve,reject)=>{
    const req=https.get(url,{headers:{'User-Agent':'Safepays/28','Accept':'application/json'}},r=>{
      let s='';
      r.on('data',c=>s+=c);
      r.on('end',()=>{
        if(r.statusCode<200||r.statusCode>=300) return reject(new Error('rate_provider_'+r.statusCode));
        try{resolve(JSON.parse(s))}catch(e){reject(e)}
      });
    });
    req.setTimeout(REQUEST_TIMEOUT_MS,()=>req.destroy(new Error('rate_timeout')));
    req.on('error',reject);
  });
}

async function providerCoinGecko(){
  const d=await fetchJson('https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=try');
  const rate=Number(d?.tether?.try);
  if(!Number.isFinite(rate)||rate<=0) throw new Error('invalid_rate');
  return {rate,source:'CoinGecko'};
}

async function providerBinance(){
  const d=await fetchJson('https://api.binance.com/api/v3/ticker/price?symbol=USDTTRY');
  const rate=Number(d?.price);
  if(!Number.isFinite(rate)||rate<=0) throw new Error('invalid_rate');
  return {rate,source:'Binance'};
}

async function getMarketSnapshot(){
  const now=Date.now();
  if(cache.market && now-cache.fetchedAt<CACHE_MS){
    return {...cache,ageMs:now-cache.fetchedAt,stale:false};
  }
  const results=[];
  for(const fn of [providerCoinGecko,providerBinance]){
    try{results.push(await fn())}catch(e){results.push({error:e.message})}
  }
  const good=results.filter(x=>Number.isFinite(x.rate));
  if(good.length){
    // Prefer the first provider but reject an obvious provider divergence.
    const rates=good.map(x=>x.rate);
    const min=Math.min(...rates), max=Math.max(...rates);
    const divergence=(max-min)/min;
    const chosen=good[0];
    if(divergence>0.03 && good.length>1){
      if(cache.market && now-cache.fetchedAt<=MAX_STALE_MS){
        return {...cache,ageMs:now-cache.fetchedAt,stale:true,warning:'provider_divergence'};
      }
      throw new Error('rate_provider_divergence');
    }
    cache={market:chosen.rate,source:chosen.source,fetchedAt:now,providers:good.map(x=>x.source)};
    return {...cache,ageMs:0,stale:false};
  }
  if(cache.market && now-cache.fetchedAt<=MAX_STALE_MS){
    return {...cache,ageMs:now-cache.fetchedAt,stale:true,warning:'using_last_known_rate'};
  }
  const demo=Number(process.env.DEMO_USDT_TRY_RATE || 40);
  if(Number.isFinite(demo)&&demo>0){
    return {market:demo,source:'Demo fallback',fetchedAt:now,ageMs:0,stale:true,providers:[],warning:'demo_fallback'};
  }
  throw new Error('rate_unavailable');
}

async function getMarketUsdtTry(){ return (await getMarketSnapshot()).market; }

function calc(market, spread){
  const s=Math.max(0,Number(spread||0));
  return Math.max(0.000001, Number(market)-s);
}

function makeQuote({marketRate,safepaysRate,network,feeUsdt,ttlSeconds=60,spread}){
  const now=Date.now();
  const expiresAt=now+ttlSeconds*1000;
  const payload={marketRate,safepaysRate,network,feeUsdt,spread,issuedAt:new Date(now).toISOString(),expiresAt:new Date(expiresAt).toISOString()};
  const id=crypto.randomBytes(8).toString('hex');
  return {quoteId:`Q-${id.toUpperCase()}`, ...payload, expiresInSeconds:ttlSeconds};
}

module.exports={getMarketUsdtTry,getMarketSnapshot,calc,makeQuote};
