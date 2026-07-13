/**
 * FCM (Firebase Cloud Messaging) — sürücü ekranı kilitli / uygulama arka plandayken
 * Socket.io uykuya düşse bile yolculuk çağrısının kaçırılmaması için push bildirimi.
 */

import * as admin from 'firebase-admin';
import { supabaseAdmin } from '../config/supabase';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import type { RideNewRequestEvent } from '../types/socket.types';

/**
 * Uygulama paketine eklenen özel bildirim sesi.
 * - Android: `android/app/src/main/res/raw/taksim_gelsin.wav` → FCM `sound: "taksim_gelsin.wav"`
 * - iOS: `Runner/taksim_gelsin.caf` bundle → APNs `aps.sound: "taksim_gelsin"` (uzantı yok)
 */
const RIDE_CALL_NOTIFICATION_SOUND_ANDROID = 'taksim_gelsin.wav';
const RIDE_CALL_NOTIFICATION_SOUND_IOS_FILE = 'taksim_gelsin.caf';

/** Admin toplu bildirim — tek seferde en fazla (FCM kota / maliyet için) */
const ADMIN_BROADCAST_MAX_TOKENS = 20_000;
const FCM_MULTICAST_MAX = 500;

let fcmApp: admin.app.App | null = null;

/** Google Cloud konsoldan indirilen JSON (snake_case alanlar) */
interface GoogleServiceAccountJson {
  project_id: string;
  client_email: string;
  private_key: string;
}

function getFirebaseApp(): admin.app.App | null {
  if (fcmApp) return fcmApp;
  const existing = admin.apps.find((a) => a?.name === 'fcm-ride-push');
  if (existing) {
    fcmApp = existing;
    return fcmApp;
  }
  const raw = env.FCM_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) {
    return null;
  }
  try {
    const cred = JSON.parse(raw) as GoogleServiceAccountJson;
    if (!cred.project_id || !cred.client_email || !cred.private_key) {
      logger.warn('[FCM] Geçersiz servis hesabı JSON (project_id / client_email / private_key).');
      return null;
    }
    fcmApp = admin.initializeApp(
      {
        credential: admin.credential.cert(cred as unknown as admin.ServiceAccount),
        projectId: cred.project_id,
      },
      'fcm-ride-push',
    );
    logger.info(`[FCM] Firebase Admin başlatıldı (proje: ${cred.project_id}).`);
    return fcmApp;
  } catch (e) {
    logger.error('[FCM] Servis hesabı JSON parse/başlatma hatası:', e);
    return null;
  }
}

type DevicePushTokenRow = { token: string; platform: 'android' | 'ios' | 'web' };

const FCM_USER_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getTokensForUser(userId: string): Promise<DevicePushTokenRow[]> {
  if (!userId || !FCM_USER_UUID_RE.test(userId)) {
    logger.warn(`[FCM] Geçersiz userId, token sorgusu atlandı: ${String(userId).slice(0, 48)}`);
    return [];
  }
  const { data, error } = await supabaseAdmin
    .from('device_push_tokens')
    .select('token, platform')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(20);

  if (error) {
    logger.warn(`[FCM] Token listesi okunamadı [${userId}]:`, error.message);
    return [];
  }
  const rows = (data ?? [])
    .map((r) => ({
      token: String((r as { token?: string }).token ?? ''),
      platform: ((r as { platform?: string }).platform ?? 'web') as 'android' | 'ios' | 'web',
    }))
    .filter((r) => r.token);
  const dedup = new Map<string, DevicePushTokenRow>();
  for (const r of rows) {
    dedup.set(r.token, r);
  }
  return [...dedup.values()];
}

async function removeInvalidTokens(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;
  await supabaseAdmin.from('device_push_tokens').delete().in('token', tokens);
}

/** iOS / Android çoklu token FCM gönderimi (ortak gövde) */
async function sendFcmMulticastToTokens(params: {
  tokenRows: DevicePushTokenRow[];
  title: string;
  body: string;
  data: Record<string, string>;
  /** Log satırı için kısa bağlam */
  logSummary: string;
  /** Android bildirim kanalı (varsayılan: yolculuk çağrısı kanalı) */
  androidChannelId?: string;
  /** Android küçük ikon: `res/drawable` içindeki dosya adı (uzantısız, örn. ic_stat_varis) */
  androidNotificationIcon?: string;
}): Promise<{ successCount: number; failureCount: number }> {
  const { tokenRows, title, body, data, logSummary, androidChannelId, androidNotificationIcon } =
    params;
  const channelId = androidChannelId ?? 'ride_calls';
  const app = getFirebaseApp();
  if (!app) return { successCount: 0, failureCount: 0 };
  if (tokenRows.length === 0) return { successCount: 0, failureCount: 0 };

  const messaging = admin.messaging(app);

  try {
    const iosSound = RIDE_CALL_NOTIFICATION_SOUND_IOS_FILE.replace(/\.(wav|aiff|caf|m4a)$/i, '');
    const tokens = tokenRows.map((r) => r.token);

    /** Tek çağrı: Android + iOS aynı OAuth ile; iOS-only data+apns bazı projelerde hatalı yanıt üretebiliyor. */
    const resp = await messaging.sendEachForMulticast({
      tokens,
      notification: { title, body },
      data,
      android: {
        priority: 'high',
        notification: {
          channelId,
          priority: 'max',
          sound: RIDE_CALL_NOTIFICATION_SOUND_ANDROID,
          defaultVibrateTimings: true,
          ...(androidNotificationIcon ? { icon: androidNotificationIcon } : {}),
        },
      },
      apns: {
        payload: {
          aps: {
            alert: { title, body },
            sound: iosSound,
            badge: 1,
          },
        },
        headers: {
          'apns-push-type': 'alert',
          'apns-priority': '10',
        },
      },
    });

    const invalid: string[] = [];
    let loggedIosApnsHint = false;
    resp.responses.forEach((r, i) => {
      if (r.success) return;
      const code = String(r.error?.code ?? '');
      const platform = tokenRows[i]?.platform ?? 'unknown';
      const t = tokens[i];
      if (
        code.includes('registration-token-not-registered') ||
        code.includes('invalid-registration-token')
      ) {
        if (t) invalid.push(t);
      } else if (r.error) {
        const isIosApnsAuth =
          platform === 'ios' &&
          (code.includes('THIRD_PARTY') ||
            code.includes('APNS') ||
            code.includes('apns') ||
            r.error.message.includes('authentication credential'));
        if (isIosApnsAuth) {
          if (!loggedIosApnsHint) {
            loggedIosApnsHint = true;
            logger.warn(
              `[FCM] iOS APNs kimlik hatası (${code}) — en az bir iOS token başarısız. `
                + 'Firebase Console → Project settings → Cloud Messaging → Apple uygulaması: '
                + 'APNs Authentication Key (.p8), Key ID ve Team ID ekleyin '
                + '(https://firebase.google.com/docs/cloud-messaging/ios/certs).',
            );
          }
        } else {
          logger.warn(
            `[FCM] Gönderim hatası idx=${i} platform=${platform} code=${code || '(yok)'}: ${r.error.message}`,
          );
        }
      }
    });

    if (invalid.length > 0) {
      await removeInvalidTokens(invalid);
      logger.info(`[FCM] Geçersiz ${invalid.length} token silindi.`);
    }

    const iosCount = tokenRows.filter((r) => r.platform === 'ios').length;
    logger.info(
      `[FCM] Push gönderildi: ${logSummary} başarı=${resp.successCount} başarısız=${resp.failureCount} ios=${iosCount} diğer=${tokenRows.length - iosCount}`,
    );
    return { successCount: resp.successCount, failureCount: resp.failureCount };
  } catch (e) {
    logger.error('[FCM] sendEachForMulticast hatası:', e);
    return { successCount: 0, failureCount: tokenRows.length };
  }
}

/** ride:new_request ile aynı anda — Socket’a ek olarak yüksek öncelikli push */
export async function sendDriverNewRidePush(
  driverId: string,
  rideData: RideNewRequestEvent,
): Promise<void> {
  const tokenRows = await getTokensForUser(driverId);
  if (tokenRows.length === 0) {
    logger.debug(`[FCM] Kayıtlı cihaz token yok, push atlandı: ${driverId}`);
    return;
  }
  if (rideData.targetDriverId && rideData.targetDriverId !== driverId) {
    logger.warn(
      `[FCM] targetDriverId ile driverId uyuşmuyor (${rideData.targetDriverId} vs ${driverId}), push iptal.`,
    );
    return;
  }

  const rideId = rideData.rideId;
  const pickupShort =
    rideData.pickupAddress.length > 80
      ? `${rideData.pickupAddress.slice(0, 77)}…`
      : rideData.pickupAddress;

  const title = 'Yeni yolculuk çağrısı';
  const body = `${pickupShort} • ~${Number(rideData.price).toFixed(0)} ₺`;

  const data: Record<string, string> = {
    type: 'ride_new_request',
    rideId,
    targetDriverId: rideData.targetDriverId,
    estimatedPrice: String(rideData.price),
    pickupAddress: rideData.pickupAddress,
    dropoffAddress: rideData.dropoffAddress,
    distanceKm: String(rideData.distanceKm ?? ''),
    pickupLat: String(rideData.pickup.lat),
    pickupLng: String(rideData.pickup.lng),
    dropoffLat: String(rideData.dropoff.lat),
    dropoffLng: String(rideData.dropoff.lng),
    customerName: rideData.customerInfo?.fullName ?? 'Müşteri',
    customerRating: String(rideData.customerInfo?.rating ?? 5),
    ...(rideData.pickupMasked ? { pickupMasked: '1' } : {}),
    ...(rideData.pickupUncertaintyM != null
      ? { pickupUncertaintyM: String(rideData.pickupUncertaintyM) }
      : {}),
    ...(rideData.acceptFeeTcoin != null
      ? { acceptFeeTcoin: String(rideData.acceptFeeTcoin) }
      : {}),
    ...(rideData.balanceTcoin != null
      ? { balanceTcoin: String(rideData.balanceTcoin) }
      : {}),
    ...(rideData.responseDeadlineMs != null
      ? { responseDeadlineMs: String(rideData.responseDeadlineMs) }
      : {}),
    ...(rideData.responseTimeoutSeconds != null
      ? { responseTimeoutSeconds: String(rideData.responseTimeoutSeconds) }
      : {}),
  };

  logger.info(`[FCM] Çağrı push: sürücü=${driverId} token_sayısı=${tokenRows.length} ride=${rideId}`);

  await sendFcmMulticastToTokens({
    tokenRows,
    title,
    body,
    data,
    logSummary: `ride=${rideId} driver=${driverId} tokens=${tokenRows.length}`,
  });
}

/** Sürücü biniş noktasına vardı — müşteriye (arka planda / kilit ekranı) bildirim */
export async function sendCustomerDriverArrivedPush(
  customerId: string,
  rideId: string,
  pickupAddress: string,
): Promise<void> {
  const tokenRows = await getTokensForUser(customerId);
  if (tokenRows.length === 0) {
    logger.debug(`[FCM] Müşteri token yok, driver_arrived atlandı: customer=${customerId} ride=${rideId}`);
    return;
  }

  const title = 'Sürücü Geldi';
  const body = 'Sürücünüz geldi sizi bekliyor.';
  const addr = (pickupAddress ?? '').trim();

  const data: Record<string, string> = {
    type: 'driver_arrived',
    rideId,
    targetCustomerId: customerId,
    ...(addr ? { pickupAddress: addr } : {}),
  };

  logger.info(
    `[FCM] Varış push: yolcu=${customerId} token_sayısı=${tokenRows.length} ride=${rideId}`,
  );

  await sendFcmMulticastToTokens({
    tokenRows,
    title,
    body,
    data,
    logSummary: `driver_arrived ride=${rideId} customer=${customerId} tokens=${tokenRows.length}`,
    androidNotificationIcon: 'ic_stat_varis',
  });
}

/** Yolculuk iptal — karşı taraf veya müşteriye sistem kapanışı (socket kapalıyken bilgi). */
export async function notifyRideCancelledByFcm(params: {
  rideId: string;
  customerId: string;
  driverId?: string | null;
  /** Müşteri iptal → sürücüye; sürücü iptal → müşteriye; system → yalnız müşteri; admin → her iki taraf. */
  scenario: 'customer' | 'driver' | 'system' | 'admin';
  /** scenario=system iken gövde */
  systemBody?: string;
}): Promise<void> {
  const { rideId, customerId, driverId, scenario, systemBody } = params;
  const did = driverId != null && String(driverId).trim() !== '' ? String(driverId).trim() : null;

  const send = async (
    userId: string,
    title: string,
    body: string,
    extraData: Record<string, string>,
    logSummary: string,
  ) => {
    const tokenRows = await getTokensForUser(userId);
    if (tokenRows.length === 0) {
      logger.debug(`[FCM] İptal push atlandı (token yok): ${logSummary}`);
      return;
    }
    const data: Record<string, string> = {
      type: 'ride_cancelled',
      rideId,
      ...extraData,
    };
    await sendFcmMulticastToTokens({
      tokenRows,
      title,
      body,
      data,
      logSummary,
    });
  };

  if (scenario === 'customer' && did) {
    await send(
      did,
      'Yolculuk iptal edildi',
      'Yolcu yolculuğu iptal etti.',
      { cancelledBy: 'customer' },
      `ride_cancelled ride=${rideId} → driver=${did}`,
    );
  } else if (scenario === 'driver' && customerId) {
    await send(
      customerId,
      'Yolculuk iptal edildi',
      'Sürücü yolculuğu iptal etti.',
      { cancelledBy: 'driver' },
      `ride_cancelled ride=${rideId} → customer=${customerId}`,
    );
  } else if (scenario === 'system' && customerId) {
    const raw = (systemBody ?? '').trim();
    const body =
      raw.length > 0 ? (raw.length > 180 ? `${raw.slice(0, 177)}…` : raw) : 'Talep kapatıldı.';
    await send(
      customerId,
      'Yolculuk iptal edildi',
      body,
      { cancelledBy: 'system' },
      `ride_cancelled_system ride=${rideId} → customer=${customerId}`,
    );
  } else if (scenario === 'admin') {
    const raw = (systemBody ?? '').trim();
    const body =
      raw.length > 0 ? (raw.length > 180 ? `${raw.slice(0, 177)}…` : raw) : 'Yönetici tarafından iptal edildi.';
    if (customerId) {
      await send(
        customerId,
        'Yolculuk iptal edildi',
        body,
        { cancelledBy: 'admin' },
        `ride_cancelled_admin ride=${rideId} → customer=${customerId}`,
      );
    }
    if (did) {
      await send(
        did,
        'Yolculuk iptal edildi',
        body,
        { cancelledBy: 'admin' },
        `ride_cancelled_admin ride=${rideId} → driver=${did}`,
      );
    }
  }
}

export type AdminPushAudience = 'all' | 'customers' | 'drivers' | 'user';

export interface AdminPushTarget {
  audience: AdminPushAudience;
  /** `audience === 'user'` iken */
  userId?: string;
  phone?: string;
}

/** `device_push_tokens` tablosundaki tüm benzersiz token'lar (sayfalı). */
async function listAllDistinctPushTokens(maxTotal: number): Promise<DevicePushTokenRow[]> {
  const PAGE = 1000;
  const dedup = new Map<string, DevicePushTokenRow>();
  let from = 0;
  while (dedup.size < maxTotal) {
    const remaining = maxTotal - dedup.size;
    const pageSize = Math.min(PAGE, remaining);
    const to = from + pageSize - 1;
    const { data, error } = await supabaseAdmin
      .from('device_push_tokens')
      .select('token, platform')
      .order('id', { ascending: true })
      .range(from, to);

    if (error) {
      logger.warn('[FCM] Toplu token listesi okunamadı:', error.message);
      break;
    }
    const batch = (data ?? []) as Array<{ token?: string; platform?: string }>;
    if (batch.length === 0) break;
    for (const raw of batch) {
      const token = String(raw.token ?? '').trim();
      if (!token) continue;
      const p = String(raw.platform ?? 'web');
      const platform = (p === 'android' || p === 'ios' || p === 'web' ? p : 'web') as
        | 'android'
        | 'ios'
        | 'web';
      dedup.set(token, { token, platform });
      if (dedup.size >= maxTotal) break;
    }
    if (batch.length < pageSize) break;
    from = to + 1;
  }
  return [...dedup.values()];
}

/** Belirli role sahip kullanıcıların kayıtlı push token'ları. */
async function listPushTokensByRole(
  role: 'customer' | 'driver',
  maxTotal: number,
): Promise<DevicePushTokenRow[]> {
  const USER_PAGE = 500;
  const dedup = new Map<string, DevicePushTokenRow>();
  let userFrom = 0;

  while (dedup.size < maxTotal) {
    const userTo = userFrom + USER_PAGE - 1;
    const { data: users, error: userErr } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('role', role)
      .order('id', { ascending: true })
      .range(userFrom, userTo);

    if (userErr) {
      logger.warn(`[FCM] ${role} kullanıcı listesi okunamadı:`, userErr.message);
      break;
    }
    const batchUsers = users ?? [];
    if (batchUsers.length === 0) break;

    const ids = batchUsers.map((u) => String((u as { id: string }).id));
    const { data: tokens, error: tokenErr } = await supabaseAdmin
      .from('device_push_tokens')
      .select('token, platform')
      .in('user_id', ids);

    if (tokenErr) {
      logger.warn(`[FCM] ${role} token listesi okunamadı:`, tokenErr.message);
      break;
    }

    for (const raw of tokens ?? []) {
      const token = String((raw as { token?: string }).token ?? '').trim();
      if (!token) continue;
      const p = String((raw as { platform?: string }).platform ?? 'web');
      const platform = (p === 'android' || p === 'ios' || p === 'web' ? p : 'web') as
        | 'android'
        | 'ios'
        | 'web';
      dedup.set(token, { token, platform });
      if (dedup.size >= maxTotal) break;
    }

    if (batchUsers.length < USER_PAGE) break;
    userFrom = userTo + 1;
  }

  return [...dedup.values()];
}

async function resolveAdminPushTargetUserId(target: AdminPushTarget): Promise<string | null> {
  if (target.userId && FCM_USER_UUID_RE.test(target.userId)) {
    return target.userId;
  }
  const phone = target.phone?.trim();
  if (!phone) return null;
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('phone', phone)
    .maybeSingle();
  if (error || !data?.id) return null;
  return String(data.id);
}

async function resolveAdminPushTokens(
  target: AdminPushTarget,
): Promise<{ tokenRows: DevicePushTokenRow[]; targetUserId?: string }> {
  switch (target.audience) {
    case 'all':
      return { tokenRows: await listAllDistinctPushTokens(ADMIN_BROADCAST_MAX_TOKENS) };
    case 'customers':
      return { tokenRows: await listPushTokensByRole('customer', ADMIN_BROADCAST_MAX_TOKENS) };
    case 'drivers':
      return { tokenRows: await listPushTokensByRole('driver', ADMIN_BROADCAST_MAX_TOKENS) };
    case 'user': {
      const userId = await resolveAdminPushTargetUserId(target);
      if (!userId) {
        return { tokenRows: [] };
      }
      return { tokenRows: await getTokensForUser(userId), targetUserId: userId };
    }
    default:
      return { tokenRows: [] };
  }
}

export type AdminBroadcastPushResult = {
  totalTokens: number;
  successCount: number;
  failureCount: number;
  batches: number;
  audience: AdminPushAudience;
  targetUserId?: string;
};

/**
 * Kayıtlı cihazlara yönetici duyurusu (tümü / yolcular / sürücüler / tek kullanıcı).
 * Admin REST + `isAdminPhone` ile korunur.
 */
export async function sendAdminBroadcastPush(
  title: string,
  body: string,
  adminUserId: string,
  target: AdminPushTarget = { audience: 'all' },
): Promise<AdminBroadcastPushResult> {
  const empty: AdminBroadcastPushResult = {
    totalTokens: 0,
    successCount: 0,
    failureCount: 0,
    batches: 0,
    audience: target.audience,
  };

  if (target.audience === 'user') {
    const hasUserId = Boolean(target.userId?.trim());
    const hasPhone = Boolean(target.phone?.trim());
    if (!hasUserId && !hasPhone) {
      throw new Error('USER_TARGET_REQUIRED');
    }
    const resolved = await resolveAdminPushTargetUserId(target);
    if (!resolved) {
      throw new Error('USER_NOT_FOUND');
    }
  }

  if (!env.FCM_SERVICE_ACCOUNT_JSON?.trim()) {
    logger.warn('[FCM] Admin yayın: FCM_SERVICE_ACCOUNT_JSON tanımlı değil.');
    return empty;
  }
  if (!getFirebaseApp()) {
    logger.warn('[FCM] Admin yayın: Firebase Admin başlatılamadı.');
    return empty;
  }

  const { tokenRows, targetUserId } = await resolveAdminPushTokens(target);
  const totalTokens = tokenRows.length;
  if (totalTokens === 0) {
    logger.info(`[FCM] Admin yayın (${target.audience}): kayıtlı push token yok.`);
    return { ...empty, targetUserId };
  }

  const sentAt = new Date().toISOString();
  let successCount = 0;
  let failureCount = 0;
  let batches = 0;
  const totalBatches = Math.ceil(tokenRows.length / FCM_MULTICAST_MAX);

  for (let i = 0; i < tokenRows.length; i += FCM_MULTICAST_MAX) {
    const chunk = tokenRows.slice(i, i + FCM_MULTICAST_MAX);
    batches += 1;
    const data: Record<string, string> = {
      type: 'admin_broadcast',
      adminUserId,
      sentAt,
      audience: target.audience,
      batchIndex: String(batches),
      batchTotal: String(totalBatches),
      ...(targetUserId ? { targetUserId } : {}),
    };
    const r = await sendFcmMulticastToTokens({
      tokenRows: chunk,
      title,
      body,
      data,
      logSummary: `admin_broadcast/${target.audience} ${batches}/${totalBatches} admin=${adminUserId}`,
    });
    successCount += r.successCount;
    failureCount += r.failureCount;
  }

  logger.info(
    `[FCM] Admin yayın bitti: audience=${target.audience} admin=${adminUserId} token=${totalTokens} başarı=${successCount} başarısız=${failureCount}`,
  );

  return {
    totalTokens,
    successCount,
    failureCount,
    batches,
    audience: target.audience,
    targetUserId,
  };
}

export type AdminLowRatingPushParams = {
  reviewId: string;
  rideId: string;
  rating: number;
  reviewerName: string;
  reviewerRole: 'customer' | 'driver';
  reviewedName: string;
  reviewedRole: 'customer' | 'driver';
  comment?: string | null;
};

function roleLabelTr(role: 'customer' | 'driver'): string {
  return role === 'driver' ? 'Sürücü' : 'Yolcu';
}

/** ADMIN_PHONES listesindeki hesapların kayıtlı cihazlarına düşük puan uyarısı (1–2 yıldız). */
export async function sendAdminLowRatingReviewPush(
  params: AdminLowRatingPushParams,
): Promise<{ totalTokens: number; successCount: number }> {
  if (params.rating > 2) {
    return { totalTokens: 0, successCount: 0 };
  }
  if (!env.FCM_SERVICE_ACCOUNT_JSON?.trim() || !getFirebaseApp()) {
    logger.warn('[FCM] Düşük puan uyarısı: FCM yapılandırılmamış.');
    return { totalTokens: 0, successCount: 0 };
  }

  const adminPhones = env.ADMIN_PHONES.split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (adminPhones.length === 0) {
    logger.warn('[FCM] Düşük puan uyarısı: ADMIN_PHONES boş.');
    return { totalTokens: 0, successCount: 0 };
  }

  const { data: adminUsers, error: adminErr } = await supabaseAdmin
    .from('users')
    .select('id')
    .in('phone', adminPhones);
  if (adminErr || !adminUsers?.length) {
    logger.warn('[FCM] Düşük puan uyarısı: admin kullanıcı bulunamadı.');
    return { totalTokens: 0, successCount: 0 };
  }

  const tokenRows: DevicePushTokenRow[] = [];
  const seen = new Set<string>();
  for (const admin of adminUsers) {
    const tokens = await getTokensForUser(String(admin.id));
    for (const t of tokens) {
      if (!seen.has(t.token)) {
        seen.add(t.token);
        tokenRows.push(t);
      }
    }
  }

  if (tokenRows.length === 0) {
    logger.info('[FCM] Düşük puan uyarısı: admin cihazında push token yok.');
    return { totalTokens: 0, successCount: 0 };
  }

  const fromRole = roleLabelTr(params.reviewerRole);
  const toRole = roleLabelTr(params.reviewedRole);
  const title = `Düşük değerlendirme (${params.rating} yıldız)`;
  const bodyBase = `${params.reviewerName} (${fromRole}) → ${params.reviewedName} (${toRole})`;
  const commentSnippet = (params.comment ?? '').trim();
  const body =
    commentSnippet.length > 0
      ? `${bodyBase}: ${commentSnippet.length > 80 ? `${commentSnippet.slice(0, 77)}…` : commentSnippet}`
      : bodyBase;

  const sentAt = new Date().toISOString();
  const r = await sendFcmMulticastToTokens({
    tokenRows,
    title,
    body,
    data: {
      type: 'admin_low_rating',
      reviewId: params.reviewId,
      rideId: params.rideId,
      rating: String(params.rating),
      sentAt,
    },
    androidChannelId: 'admin_alerts',
    logSummary: `admin_low_rating review=${params.reviewId} rating=${params.rating}`,
  });

  logger.info(
    `[FCM] Düşük puan uyarısı: review=${params.reviewId} rating=${params.rating} token=${tokenRows.length} başarı=${r.successCount}`,
  );

  return { totalTokens: tokenRows.length, successCount: r.successCount };
}
