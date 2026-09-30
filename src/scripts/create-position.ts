import { AerodromeService } from '../aerodrome/service';
import { StorageService } from '../engine/storage';
import { config } from '../config';

async function main() {
  console.log('====================================================');
  console.log('🚀 AERODROME SLIPSTREAM - CREAR POSICIÓN 50/50 AUTOMÁTICA');
  console.log('====================================================');

  const service = new AerodromeService();
  const storage = new StorageService();

  console.log(`Wallet satélite: ${service.account.address}`);
  const state = await service.getPoolState();
  console.log(`Precio actual ETH/USDC: $${state.currentPrice.toFixed(2)} | Tick: ${state.currentTick}`);
  console.log(`Saldos disponibles:`);
  console.log(`   - USDC: ${state.usdcBalance.toFixed(2)} USDC`);
  console.log(`   - ETH:  ${state.ethBalance.toFixed(5)} ETH`);

  if (state.usdcBalance < 10) {
    console.error('❌ Error: Se requieren al menos 10 USDC para crear la posición.');
    process.exit(1);
  }

  const depositUsdc = state.usdcBalance;
  console.log(`\nIniciando creación con ${depositUsdc.toFixed(2)} USDC...`);
  console.log(`1. Se cambiarán ${(depositUsdc / 2).toFixed(2)} USDC a WETH`);
  console.log(`2. Se mantendrán ${(depositUsdc / 2).toFixed(2)} USDC`);
  console.log(`3. Se minteará el rango centrado de 4.0% en Aerodrome Slipstream\n`);

  const result = await service.createCentered5050Position(depositUsdc);

  if (result.success) {
    console.log('====================================================');
    console.log('🎉 ¡POSICIÓN 50/50 CREADA CON ÉXITO EN BASE MAINNET!');
    console.log('====================================================');
    console.log(`Token ID NFT:  #${result.tokenId || 'LP'}`);
    console.log(`Rango Activo:  $${result.priceLower.toFixed(2)} - $${result.priceUpper.toFixed(2)}`);
    console.log(`Ticks:         [${result.tickLower}, ${result.tickUpper}]`);
    console.log(`Swap Tx:       https://basescan.org/tx/${result.swapTx}`);
    console.log(`Mint Tx:       https://basescan.org/tx/${result.mintTx}`);

    // Update storage state
    storage.updateState(s => {
      s.activePosition = {
        tokenId: result.tokenId || 'NEW_LP',
        tickLower: result.tickLower,
        tickUpper: result.tickUpper,
        priceLower: result.priceLower,
        priceUpper: result.priceUpper,
        inRange: true
      };
      s.outOfRangeSince = null;
    });

    storage.addLog(
      'ACTION',
      `🚀 Posición 50/50 (#${result.tokenId}) creada en Base! Rango: $${result.priceLower.toFixed(2)} - $${result.priceUpper.toFixed(2)}`
    );

    console.log('\n✅ Estado guardado en bot-state.json. El bot y dashboard ya están sincronizados.');
  } else {
    console.error('❌ Error durante la creación:', result.error);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Error fatal:', err);
  process.exit(1);
});
