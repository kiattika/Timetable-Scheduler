/**
 * Firestore Database Cost & Pricing Calculation Utilities
 * Pure financial calculations and types for Firestore Read/Write operations.
 * NO simulated data, NO random numbers, NO localStorage storage.
 */

export interface FirestoreDailyMetric {
  date: string; // YYYY-MM-DD
  reads: number;
  writes: number;
  deletes: number;
}

export interface FirestoreUsageResponse {
  success: boolean;
  projectId: string;
  source: string;
  timeRange: {
    days: number;
    startDate: string;
    endDate: string;
  };
  dailyStats: FirestoreDailyMetric[];
  totals: {
    totalReads: number;
    totalWrites: number;
    totalDeletes: number;
    dailyAverageReads: number;
    dailyAverageWrites: number;
    dailyAverageDeletes: number;
  };
  fetchedAt: string;
}

export interface PricingConfig {
  freeDailyReads: number;
  freeDailyWrites: number;
  freeDailyDeletes: number;
  freeStorageGB: number;
  readCostPer100kUsd: number;
  writeCostPer100kUsd: number;
  deleteCostPer100kUsd: number;
  storageCostPerGBMonthUsd: number;
  thbExchangeRate: number; // 1 USD = X THB
}

export const DEFAULT_PRICING: PricingConfig = {
  freeDailyReads: 50000,
  freeDailyWrites: 20000,
  freeDailyDeletes: 20000,
  freeStorageGB: 1.0,
  readCostPer100kUsd: 0.06, // $0.06 / 100k reads
  writeCostPer100kUsd: 0.18, // $0.18 / 100k writes
  deleteCostPer100kUsd: 0.02, // $0.02 / 100k deletes
  storageCostPerGBMonthUsd: 0.18, // $0.18 / GB / month
  thbExchangeRate: 35.0, // approx 35 THB / 1 USD
};

export interface CostBreakdown {
  totalReads: number;
  totalWrites: number;
  totalDeletes: number;
  avgStorageMB: number;
  
  billableReads: number;
  billableWrites: number;
  billableDeletes: number;
  billableStorageGB: number;

  costReadsUsd: number;
  costWritesUsd: number;
  costDeletesUsd: number;
  costStorageUsd: number;
  totalCostUsd: number;
  totalCostThb: number;

  isWithinFreeTier: boolean;
  freeTierReadPercentage: number; // 0-100%
  freeTierWritePercentage: number; // 0-100%
}

export const calculatePeriodCost = (
  records: FirestoreDailyMetric[],
  pricing: PricingConfig = DEFAULT_PRICING,
  storageMB: number = 0
): CostBreakdown => {
  let totalReads = 0;
  let totalWrites = 0;
  let totalDeletes = 0;

  let totalBillableReads = 0;
  let totalBillableWrites = 0;
  let totalBillableDeletes = 0;

  records.forEach(r => {
    totalReads += r.reads || 0;
    totalWrites += r.writes || 0;
    totalDeletes += r.deletes || 0;

    // Daily billing model (Free tier applies per day)
    const billableReadsToday = Math.max(0, (r.reads || 0) - pricing.freeDailyReads);
    const billableWritesToday = Math.max(0, (r.writes || 0) - pricing.freeDailyWrites);
    const billableDeletesToday = Math.max(0, (r.deletes || 0) - pricing.freeDailyDeletes);

    totalBillableReads += billableReadsToday;
    totalBillableWrites += billableWritesToday;
    totalBillableDeletes += billableDeletesToday;
  });

  const dayCount = Math.max(1, records.length);
  const avgStorageGB = (storageMB || 0) / 1024;
  const billableStorageGB = Math.max(0, avgStorageGB - pricing.freeStorageGB);

  const costReadsUsd = (totalBillableReads / 100000) * pricing.readCostPer100kUsd;
  const costWritesUsd = (totalBillableWrites / 100000) * pricing.writeCostPer100kUsd;
  const costDeletesUsd = (totalBillableDeletes / 100000) * pricing.deleteCostPer100kUsd;
  const costStorageUsd = billableStorageGB * pricing.storageCostPerGBMonthUsd * (dayCount / 30);

  const totalCostUsd = costReadsUsd + costWritesUsd + costDeletesUsd + costStorageUsd;
  const totalCostThb = totalCostUsd * pricing.thbExchangeRate;

  const avgDailyReads = totalReads / dayCount;
  const avgDailyWrites = totalWrites / dayCount;

  const freeTierReadPercentage = Math.min(100, (avgDailyReads / pricing.freeDailyReads) * 100);
  const freeTierWritePercentage = Math.min(100, (avgDailyWrites / pricing.freeDailyWrites) * 100);

  return {
    totalReads,
    totalWrites,
    totalDeletes,
    avgStorageMB: +storageMB.toFixed(2),
    billableReads: totalBillableReads,
    billableWrites: totalBillableWrites,
    billableDeletes: totalBillableDeletes,
    billableStorageGB: +billableStorageGB.toFixed(3),
    costReadsUsd: +costReadsUsd.toFixed(4),
    costWritesUsd: +costWritesUsd.toFixed(4),
    costDeletesUsd: +costDeletesUsd.toFixed(4),
    costStorageUsd: +costStorageUsd.toFixed(4),
    totalCostUsd: +totalCostUsd.toFixed(4),
    totalCostThb: +totalCostThb.toFixed(2),
    isWithinFreeTier: totalCostUsd === 0,
    freeTierReadPercentage: +freeTierReadPercentage.toFixed(1),
    freeTierWritePercentage: +freeTierWritePercentage.toFixed(1),
  };
};
