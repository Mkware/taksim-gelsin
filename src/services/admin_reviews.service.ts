/**
 * Admin panel — yolculuk değerlendirmeleri listesi ve özet sayıları.
 */

import { supabaseAdmin } from '../config/supabase';
import { logger } from '../utils/logger';

export type AdminReviewItem = {
  id: string;
  ride_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  reviewer: {
    id: string;
    full_name: string;
    phone: string;
    role: 'customer' | 'driver';
  };
  reviewed: {
    id: string;
    full_name: string;
    phone: string;
    role: 'customer' | 'driver';
  };
  ride: {
    id: string;
    pickup_address: string;
    dropoff_address: string;
  } | null;
};

export type AdminReviewListResult = {
  items: AdminReviewItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  counts: Record<1 | 2 | 3 | 4 | 5, number>;
};

type UserRow = {
  id: string;
  full_name: string;
  phone: string;
  role: 'customer' | 'driver';
};

function emptyCounts(): Record<1 | 2 | 3 | 4 | 5, number> {
  return { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
}

export async function getAdminReviewRatingCounts(): Promise<Record<1 | 2 | 3 | 4 | 5, number>> {
  const counts = emptyCounts();
  const { data, error } = await supabaseAdmin.from('reviews').select('rating');
  if (error) {
    logger.warn('[Admin] Değerlendirme sayıları okunamadı:', error.message);
    return counts;
  }
  for (const row of data ?? []) {
    const r = Number((row as { rating?: number }).rating);
    if (r >= 1 && r <= 5) {
      counts[r as 1 | 2 | 3 | 4 | 5] += 1;
    }
  }
  return counts;
}

export async function listAdminReviews(opts: {
  rating?: number;
  page: number;
  limit: number;
}): Promise<AdminReviewListResult> {
  const page = Math.max(1, opts.page);
  const limit = Math.min(Math.max(1, opts.limit), 100);
  const offset = (page - 1) * limit;

  let query = supabaseAdmin
    .from('reviews')
    .select('id, ride_id, reviewer_id, reviewed_id, rating, comment, created_at', { count: 'exact' })
    .order('created_at', { ascending: false });

  if (opts.rating !== undefined) {
    query = query.eq('rating', opts.rating);
  }

  const { data: rows, error, count } = await query.range(offset, offset + limit - 1);

  if (error) {
    logger.error('[Admin] Değerlendirme listesi:', error.message);
    throw new Error('REVIEWS_LIST_FAILED');
  }

  const reviews = rows ?? [];
  const userIds = new Set<string>();
  const rideIds = new Set<string>();
  for (const r of reviews) {
    userIds.add(r.reviewer_id as string);
    userIds.add(r.reviewed_id as string);
    rideIds.add(r.ride_id as string);
  }

  const userMap = new Map<string, UserRow>();
  if (userIds.size > 0) {
    const { data: users, error: userErr } = await supabaseAdmin
      .from('users')
      .select('id, full_name, phone, role')
      .in('id', [...userIds]);
    if (userErr) {
      logger.warn('[Admin] Değerlendirme kullanıcıları:', userErr.message);
    } else {
      for (const u of users ?? []) {
        userMap.set(u.id as string, u as UserRow);
      }
    }
  }

  const rideMap = new Map<string, { id: string; pickup_address: string; dropoff_address: string }>();
  if (rideIds.size > 0) {
    const { data: rides, error: rideErr } = await supabaseAdmin
      .from('rides')
      .select('id, pickup_address, dropoff_address')
      .in('id', [...rideIds]);
    if (rideErr) {
      logger.warn('[Admin] Değerlendirme yolculukları:', rideErr.message);
    } else {
      for (const ride of rides ?? []) {
        rideMap.set(ride.id as string, {
          id: ride.id as string,
          pickup_address: String(ride.pickup_address ?? ''),
          dropoff_address: String(ride.dropoff_address ?? ''),
        });
      }
    }
  }

  const fallbackUser = (id: string): UserRow => ({
    id,
    full_name: 'Bilinmiyor',
    phone: '—',
    role: 'customer',
  });

  const items: AdminReviewItem[] = reviews.map((r) => {
    const reviewer = userMap.get(r.reviewer_id as string) ?? fallbackUser(r.reviewer_id as string);
    const reviewed = userMap.get(r.reviewed_id as string) ?? fallbackUser(r.reviewed_id as string);
    return {
      id: r.id as string,
      ride_id: r.ride_id as string,
      rating: Number(r.rating),
      comment: (r.comment as string | null) ?? null,
      created_at: r.created_at as string,
      reviewer: {
        id: reviewer.id,
        full_name: reviewer.full_name,
        phone: reviewer.phone,
        role: reviewer.role,
      },
      reviewed: {
        id: reviewed.id,
        full_name: reviewed.full_name,
        phone: reviewed.phone,
        role: reviewed.role,
      },
      ride: rideMap.get(r.ride_id as string) ?? null,
    };
  });

  const total = count ?? 0;
  const counts = await getAdminReviewRatingCounts();

  return {
    items,
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    counts,
  };
}
