import { supabaseAdmin } from '../config/supabase';
import { redis } from '../config/redis';
import { getPlatformSettings } from './platform_settings.service';
import type { TypedSocketServer } from '../sockets/socket.manager';

const DRIVER_SOCKET_KEY = 'driver:socket:';
const DRIVER_LOCATION_KEY = 'driver:location:';

export async function fetchDriverBalance(driverId: string): Promise<number> {
  const { data } = await supabaseAdmin.from('drivers').select('balance').eq('id', driverId).maybeSingle();
  return Number((data as { balance?: number } | null)?.balance ?? 0);
}

export function canDriverTurnOnline(balance: number): boolean {
  return balance >= getPlatformSettings().minDriverOnlineBalanceTcoin;
}

/**
 * Bakiye belli eşiğin altına veya eşit düştüyse ve sürücü çevrimiçiyse DB'den çevrimdışı yap,
 * ilgili Redis anahtarlarını sil ve sürücü odasına bildir.
 * @param maxBalanceInclusive — bu değer ve altı tetikler (varsayılan 0 = "0 T Coin kaldı").
 */
export async function forceDriverOfflineIfBalanceAtOrBelow(
  driverId: string,
  io: TypedSocketServer,
  maxBalanceInclusive = 0,
): Promise<boolean> {
  const { data: row } = await supabaseAdmin
    .from('drivers')
    .select('balance, is_online')
    .eq('id', driverId)
    .maybeSingle();

  const bal = Number((row as { balance?: number } | null)?.balance ?? 0);
  const online = (row as { is_online?: boolean } | null)?.is_online === true;
  if (!online) return false;
  if (bal > maxBalanceInclusive) return false;

  await supabaseAdmin
    .from('drivers')
    .update({ is_online: false, is_available: false })
    .eq('id', driverId);

  await Promise.all([
    redis.del(`${DRIVER_SOCKET_KEY}${driverId}`),
    redis.del(`${DRIVER_LOCATION_KEY}${driverId}`),
  ]);

  io.to(`driver:${driverId}`).emit('driver:forced_offline', {
    reason: 'ZERO_BALANCE',
    balance: bal,
    message:
      'Bakiyeniz bittiği için çevrimdışı yapıldınız. T Coin yükleyerek tekrar çevrimiçi olabilirsiniz.',
  });

  return true;
}
