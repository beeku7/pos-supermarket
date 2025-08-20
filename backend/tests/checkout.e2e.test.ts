import request from 'supertest';
import express from 'express';
import prisma from '../src/prisma';
import { v4 as uuid } from 'uuid';
import { PrismaClient } from '@prisma/client';

/**
 * This test covers the critical checkout flow: scanning items, applying a
 * percentage discount, splitting payments and completing the sale.  It
 * demonstrates how the API can be exercised end to end without a browser.
 */
describe('Checkout E2E Flow', () => {
  let server: any;
  beforeAll(async () => {
    // Use a separate database file for testing
    process.env.DATABASE_URL = 'file:./test.db';
    // Initialise prisma client
    (prisma as unknown as PrismaClient).$connect();
    // Run migrations
    // In a real test we would run the SQL in init.sql here.
    // Start the express app
    const app = require('../src/index');
    server = app.default || app;
  });
  afterAll(async () => {
    await (prisma as unknown as PrismaClient).$disconnect();
  });
  it('scan items -> discount -> split pay', async () => {
    // Start a cart
    const startRes = await request(server).post('/api/checkout/start').expect(200);
    const cartId = startRes.body.cartId;
    // Scan first item (Basamti Rice barcode)
    await request(server)
      .post('/api/checkout/scan')
      .send({ cartId, barcode: '8900000000011' })
      .expect(200);
    // Scan second item
    await request(server)
      .post('/api/checkout/scan')
      .send({ cartId, barcode: '8900000000028' })
      .expect(200);
    // Apply 10% discount on entire cart
    await request(server)
      .post('/api/checkout/discount')
      .send({ cartId, discountPercent: 10 })
      .expect(200);
    // Fetch cart to compute total
    const cartRes = await request(server)
      .post('/api/checkout/scan')
      .send({ cartId, barcode: '8900000000011' });
    const cart = cartRes.body.cart;
    const total = cart.lines.reduce((sum: number, l: any) => sum + l.lineTotal, 0);
    // Split payment: half UPI, half cash
    const half = Math.round((total / 2) * 100) / 100;
    const receiptRes = await request(server)
      .post('/api/checkout/complete')
      .send({
        cartId,
        payments: [
          { methodCode: 'UPI', amount: half, reference: 'upi-txn-123' },
          { methodCode: 'CASH', amount: total - half },
        ],
      })
      .expect(200);
    expect(receiptRes.body.totalAmount).toBeCloseTo(total);
    expect(receiptRes.body.payments.length).toBe(2);
  });
});