const { createPublicClient, http } = require('viem');
const { base } = require('viem/chains');

const c = createPublicClient({ chain: base, transport: http('https://mainnet.base.org') });
async function check() {
  const hash = '0xbe3cea8ac168e603d877580401b5d46ecce6da9191f8ba1d7c217beb2f6b3698';
  try {
    const tx = await c.getTransaction({ hash });
    console.log('Tx:', tx ? 'Found' : 'Not found', 'nonce:', tx?.nonce, 'gasPrice:', tx?.gasPrice);
    const receipt = await c.getTransactionReceipt({ hash }).catch(() => null);
    console.log('Receipt status:', receipt?.status);
  } catch (e) {
    console.log('Error getting tx:', e.message);
  }
}
check();
