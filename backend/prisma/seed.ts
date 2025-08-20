import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Seed roles
  const adminRole = await prisma.role.upsert({
    where: { name: 'Admin' },
    update: {},
    // permissions stored as JSON string; empty object serialised
    create: { name: 'Admin', permissions: '{}' },
  });
  const supervisorRole = await prisma.role.upsert({
    where: { name: 'Supervisor' },
    update: {},
    create: { name: 'Supervisor', permissions: '{}' },
  });
  const cashierRole = await prisma.role.upsert({
    where: { name: 'Cashier' },
    update: {},
    create: { name: 'Cashier', permissions: '{}' },
  });
  // Seed users with hashed password 'password' (in real world use bcrypt)
  await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      password: 'password',
      fullName: 'Administrator',
      role: { connect: { id: adminRole.id } },
    },
  });
  // Seed tax rates
  const taxRates = [
    { name: 'GST 0%', rate: 0, cess: 0 },
    { name: 'GST 5%', rate: 5, cess: 0 },
    { name: 'GST 12%', rate: 12, cess: 0 },
    { name: 'GST 18%', rate: 18, cess: 0 },
    { name: 'GST 28%', rate: 28, cess: 0 },
  ];
  for (const t of taxRates) {
    await prisma.tax.upsert({ where: { name: t.name }, update: {}, create: t });
  }
  // Seed payment methods
  const paymentMethods = [
    { code: 'CASH', name: 'Cash' },
    { code: 'CARD', name: 'Card', meta: JSON.stringify({ networks: ['Visa', 'Mastercard', 'RuPay'] }) },
    { code: 'UPI', name: 'UPI', meta: JSON.stringify({ note: 'Unified Payments Interface' }) },
    { code: 'WALLET', name: 'Wallet', meta: JSON.stringify({ providers: ['Paytm', 'PhonePe', 'Amazon Pay'] }) },
    { code: 'GIFT_CARD', name: 'Gift Card' },
    { code: 'STORE_CREDIT', name: 'Store Credit' },
  ];
  for (const pm of paymentMethods) {
    await prisma.paymentMethod.upsert({ where: { code: pm.code }, update: {}, create: pm });
  }
  // Seed categories
  const groceryCat = await prisma.category.upsert({ where: { name: 'Grocery' }, update: {}, create: { name: 'Grocery' } });
  const snacksCat = await prisma.category.upsert({ where: { name: 'Snacks' }, update: {}, create: { name: 'Snacks' } });
  // Seed items (SKU, name, MRP, cost, category, tax)
  const gst5 = await prisma.tax.findFirst({ where: { rate: 5 } });
  const gst12 = await prisma.tax.findFirst({ where: { rate: 12 } });
  const gst18 = await prisma.tax.findFirst({ where: { rate: 18 } });
  await prisma.item.upsert({
    where: { sku: 'SKU0001' },
    update: {},
    create: {
      sku: 'SKU0001',
      name: 'Basmati Rice 1kg',
      description: 'Premium basmati rice',
      category: { connect: { id: groceryCat.id } },
      tax: { connect: { id: gst5?.id ?? 1 } },
      unit: 'kg',
      mrp: 120,
      cost: 90,
      barcodes: { create: [{ code: '8900000000011', isPrimary: true }] },
    },
  });
  await prisma.item.upsert({
    where: { sku: 'SKU0002' },
    update: {},
    create: {
      sku: 'SKU0002',
      name: 'Masala Chips 200g',
      category: { connect: { id: snacksCat.id } },
      tax: { connect: { id: gst12?.id ?? 1 } },
      unit: 'pkt',
      mrp: 30,
      cost: 20,
      barcodes: { create: [{ code: '8900000000028', isPrimary: true }] },
    },
  });
  await prisma.item.upsert({
    where: { sku: 'SKU0003' },
    update: {},
    create: {
      sku: 'SKU0003',
      name: 'Toothpaste 100g',
      category: { connect: { id: snacksCat.id } },
      tax: { connect: { id: gst18?.id ?? 1 } },
      unit: 'tube',
      mrp: 45,
      cost: 30,
      barcodes: { create: [{ code: '8900000000035', isPrimary: true }] },
    },
  });
  console.log('Seed data inserted successfully');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });