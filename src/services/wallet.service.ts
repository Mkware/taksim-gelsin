import { supabaseAdmin } from '../config/supabase';
import { logger } from '../utils/logger';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** accept_ride_with_fee RPC sonucundaki ride alanları (handler tarafından kullanılan alt küme). */
export interface AcceptedRideRow {
  id: string;
  customer_id: string;
  driver_id: string | null;
  status: string;
  estimated_price: number;
  final_price: number | null;
  platform_fee: number | null;
  requested_at: string;
  accepted_at: string | null;
  pickup_address: string;
  dropoff_address: string;
  distance_km: number | null;
  pickup_verification_code: string | null;
  pickup_code_verified: boolean;
}

export type AcceptRideResult =
  | { ok: true; ride: AcceptedRideRow }
  | { ok: false; code: 'RIDE_UNAVAILABLE' | 'INSUFFICIENT_BALANCE' | 'RPC_ERROR' };

/**
 * ATOMİK kabul + kabul ücreti kesintisi (tek PostgreSQL transaction).
 *
 * Önceki akış kesinti ve kabulü ayrı adımlarda yapıyor, başarısızlıkta ayrı bir iade
 * RPC'sine güveniyordu (iade başarısız olursa para "havada" kalabiliyordu). Bu fonksiyon
 * hepsini tek transaction'da yapar:
 *   - Kabul olmazsa (RIDE_UNAVAILABLE) hiç kesinti yapılmaz.
 *   - Bakiye yetersizse (INSUFFICIENT_BALANCE) kabul de geri alınır.
 */
export async function acceptRideWithFee(
  rideId: string,
  driverId: string,
  feeTcoin: number,
  pickupPin: string,
): Promise<AcceptRideResult> {
  const { data, error } = await supabaseAdmin.rpc('accept_ride_with_fee', {
    p_ride_id: rideId,
    p_driver_id: driverId,
    p_fee: feeTcoin,
    p_pickup_pin: pickupPin,
    p_idempotency_key: `fee:accept:${rideId}`,
  });

  if (error) {
    logger.error(`[Wallet] accept_ride_with_fee ${rideId} driver=${driverId}:`, error);
    return { ok: false, code: 'RPC_ERROR' };
  }

  const res = data as { ok?: boolean; code?: string; ride?: AcceptedRideRow } | null;
  if (!res || res.ok !== true || !res.ride) {
    const code = res?.code === 'RIDE_UNAVAILABLE' || res?.code === 'INSUFFICIENT_BALANCE'
      ? res.code
      : 'RPC_ERROR';
    return { ok: false, code };
  }
  return { ok: true, ride: res.ride };
}

/**
 * Kabul ücreti düş — yetersiz bakiyede false.
 * (Geriye dönük uyumluluk; yeni akış acceptRideWithFee kullanır.)
 */
export async function tryDeductRideAcceptFee(driverId: string, amountTcoin: number): Promise<boolean> {
  if (amountTcoin <= 0) return true;
  const { data, error } = await supabaseAdmin.rpc('try_deduct_driver_balance', {
    p_driver_id: driverId,
    p_amount: amountTcoin,
  });
  if (error) {
    logger.error(`[Wallet] try_deduct_driver_balance ${driverId}:`, error);
    return false;
  }
  return data === true;
}

/**
 * IDEMPOTENT kabul ücreti iadesi — aynı idempotencyKey iki kez gelse bile tek kredi.
 * Geçici ağ/DB hatalarında yeniden dener; tüm denemeler başarısızsa false.
 */
export async function refundRideAcceptFeeIdempotent(
  driverId: string,
  rideId: string,
  amountTcoin: number,
  idempotencyKey: string,
  reason = 'ride accept fee refund',
): Promise<boolean> {
  if (amountTcoin <= 0) return true;
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { data, error } = await supabaseAdmin.rpc('refund_ride_accept_fee', {
      p_driver_id: driverId,
      p_ride_id: rideId,
      p_amount: amountTcoin,
      p_idempotency_key: idempotencyKey,
      p_reason: reason,
    });
    const res = data as { ok?: boolean; duplicate?: boolean } | null;
    if (!error && res?.ok === true) {
      if (res.duplicate) {
        logger.info(`[Wallet] iade zaten işlenmiş (idempotent) key=${idempotencyKey} driver=${driverId}`);
      } else if (attempt > 1) {
        logger.info(`[Wallet] refund_ride_accept_fee başarılı (deneme ${attempt}) driver=${driverId}`);
      }
      return true;
    }
    logger.warn(
      `[Wallet] refund_ride_accept_fee deneme ${attempt}/${maxAttempts} driver=${driverId} key=${idempotencyKey}:`,
      error?.message ?? res?.ok,
    );
    if (attempt < maxAttempts) {
      await sleep(250 * attempt);
    }
  }
  logger.error(
    `[Wallet] KRİTİK: refund_ride_accept_fee tüm denemeler başarısız driver=${driverId} ride=${rideId} amount=${amountTcoin} key=${idempotencyKey} — manuel iade gerekir`,
  );
  logger.error(
    `[Wallet] ${JSON.stringify({
      type: 'WALLET_RECONCILE_NEEDED',
      op: 'refundRideAcceptFeeIdempotent',
      driverId,
      rideId,
      amountTcoin,
      idempotencyKey,
      at: new Date().toISOString(),
    })}`,
  );
  return false;
}

/**
 * Kabul ücreti iadesi — geçici ağ/DB hatalarında birkaç kez yeniden dener.
 * @returns iade başarılıysa true; tüm denemeler başarısızsa false (manuel müdahale gerekir)
 */
export async function refundRideAcceptFee(driverId: string, amountTcoin: number): Promise<boolean> {
  if (amountTcoin <= 0) return true;
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { error } = await supabaseAdmin.rpc('refund_driver_balance', {
      p_driver_id: driverId,
      p_amount: amountTcoin,
    });
    if (!error) {
      if (attempt > 1) {
        logger.info(`[Wallet] refund_driver_balance başarılı (deneme ${attempt}) driver=${driverId}`);
      }
      return true;
    }
    logger.warn(
      `[Wallet] refund_driver_balance deneme ${attempt}/${maxAttempts} driver=${driverId}:`,
      error.message,
    );
    if (attempt < maxAttempts) {
      await sleep(250 * attempt);
    }
  }
  const reconcilePayload = {
    type: 'WALLET_RECONCILE_NEEDED',
    op: 'refundRideAcceptFee',
    driverId,
    amountTcoin,
    at: new Date().toISOString(),
  };
  logger.error(
    `[Wallet] KRİTİK: refund_driver_balance tüm denemeler başarısız driver=${driverId} amount=${amountTcoin} — manuel iade gerekir`,
  );
  logger.error(`[Wallet] ${JSON.stringify(reconcilePayload)}`);
  return false;
}

/**
 * Kabul ücreti düşüldü ama yolculuk DB'ye yazılamadı — iade başarısız olduysa aynı yapılandırılmış log.
 */
export function logRefundAfterAcceptFailure(
  driverId: string,
  amountTcoin: number,
  rideId: string,
  refunded: boolean,
): void {
  if (refunded) return;
  logger.error(
    `[Wallet] ride:accept DB reddi sonrası iade BAŞARISIZ driver=${driverId} ride=${rideId} amount=${amountTcoin}`,
  );
  logger.error(
    `[Wallet] ${JSON.stringify({
      type: 'WALLET_RECONCILE_NEEDED',
      op: 'refundAfterAcceptDbFailure',
      driverId,
      amountTcoin,
      rideId,
      at: new Date().toISOString(),
    })}`,
  );
}
