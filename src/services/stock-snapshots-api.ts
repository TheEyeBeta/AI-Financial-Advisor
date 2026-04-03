import { supabase } from '@/lib/supabase';

import { createStockSnapshotsApi, type StockSnapshotQuery } from '@/services/stock-cache';

const fromStockSnapshots = () => supabase.schema('market').from('stock_snapshots') as StockSnapshotQuery;

export const stockSnapshotsApi = createStockSnapshotsApi(fromStockSnapshots);
