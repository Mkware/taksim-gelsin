/**
 * Eşleştirme / sürücü çağrısı Redis yardımcıları.
 * Kabul penceresi süresi: `platform_settings.driverResponseTimeoutSeconds` (admin).
 */

/** Redis: kabul penceresi bitişi (epoch ms, string) — teklif başına (paralel dalga desteği).
 *  TTL, pending/kilit ile aynı (+5 sn tampon). */
export function redisDriverResponseDeadlineKey(rideId: string, driverId: string): string {
  return `${redisDriverResponseDeadlinePrefix(rideId)}${driverId}`;
}

/** Lua içinde driverId eklenerek anahtar üretmek için prefix. */
export function redisDriverResponseDeadlinePrefix(rideId: string): string {
  return `ride:driver_response_deadline:${rideId}:`;
}

/** `driver:pending_offer` / `ride:pending` TTL — gerçek pencereden birkaç sn fazla (temizlik tamponu). */
export function driverOfferRedisTtlSecondsFromMs(timeoutMs: number): number {
  return Math.ceil(timeoutMs / 1000) + 5;
}
