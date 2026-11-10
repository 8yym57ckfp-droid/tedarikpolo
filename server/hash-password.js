const crypto = require('node:crypto');

function readHiddenPassword() {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    const output = process.stdout;
    if (!input.isTTY || typeof input.setRawMode !== 'function') {
      reject(new Error('Run this tool in an interactive terminal.'));
      return;
    }

    let password = '';
    let finished = false;
    const finish = (error = null) => {
      if (finished) return;
      finished = true;
      input.setRawMode(false);
      input.pause();
      input.off('data', onData);
      output.write('\n');
      if (error) reject(error);
      else resolve(password);
    };
    const onData = (chunk) => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\u0003') {
          finish(new Error('Cancelled.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          finish();
          return;
        }
        if (character === '\u007f' || character === '\b') {
          password = password.slice(0, -1);
          continue;
        }
        password += character;
      }
    };

    output.write('Password (input hidden): ');
    input.setRawMode(true);
    input.resume();
    input.on('data', onData);
  });
}

async function main() {
  const password = await readHiddenPassword();
  if (password.length < 8) throw new Error('Password must be at least 8 characters.');
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  process.stdout.write(`scrypt$${salt}$${hash}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
