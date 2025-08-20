import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // --- SETTINGS (key/value) ---
  const settings: Record<string, string> = {
    STORE_NAME: 'Your Store',
    STORE_ADDRESS: '123 Market Road, Bengaluru, KA 560001',
    STORE_GSTIN: '29ABCDE1234F1Z5',
    PLACE_OF_SUPPLY: 'KA',
    UPI_VPA: 'beeku7@ibl',
  };

  for (const [key, value] of Object.entries(settings)) {
    await prisma.setting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }

  // --- TAXES (if you already seed these, keep your version) ---
  const taxRates = [
    { name: 'GST 0%', rate: 0 },
    { name: 'GST 5%', rate: 5 },
    { name: 'GST 12%', rate: 12 },
    { name: 'GST 18%', rate: 18 },
    { name: 'GST 28%', rate: 28 },
  ];
  for (const t of taxRates) {
    await prisma.tax.upsert({
      where: { id: (await prisma.tax.findFirst({ where: { rate: t.rate } }))?.id ?? -1 },
      update: { name: t.name, rate: t.rate },
      create: t,
    });
  }

  // --- PAYMENT METHODS ---
  const methods = [
    { code: 'CASH', name: 'Cash' },
    { code: 'UPI', name: 'UPI' },
    { code: 'CARD', name: 'Card' },
    { code: 'WALLET', name: 'Wallet' },
  ];
  for (const m of methods) {
    await prisma.paymentMethod.upsert({
      where: { code: m.code },
      update: { name: m.name, active: true },
      create: { ...m, active: true },
    });
  }

  console.log('Seed done.');
}

main().finally(() => prisma.$disconnect());
