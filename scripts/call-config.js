const http = require('http');

function postConfig(tokenId, mode, thresholdUsd, enabled) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ tokenId, mode, thresholdUsd, enabled });
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/compound-config',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  console.log(await postConfig('77375885', 'reinvest', 25, true));
  console.log(await postConfig('77375873', 'reinvest', 25, true));
}
main();
