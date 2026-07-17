/**
 * Driver Route'ları
 * Sürücü profil CRUD, online/offline durumu, konum yönetimi.
 */

import { Router, Request, Response } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { roleMiddleware } from '../../middleware/role.middleware';
import { supabaseAdmin } from '../../config/supabase';
import { logger } from '../../utils/logger';
import { getPlatformSettings } from '../../services/platform_settings.service';
import { fetchDriverBalance, canDriverTurnOnline } from '../../services/driver_online_policy.service';

const router = Router();

// Tüm driver route'ları JWT ile korunur
router.use(authMiddleware);

// Sürücü profili getir
router.get('/me', roleMiddleware(['driver']), async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;

    // Sürücü bilgilerini users ile join ederek getir
    const { data, error } = await supabaseAdmin
      .from('drivers')
      .select(`
        id, vehicle_plate, vehicle_model, vehicle_color, balance, driver_code,
        is_online, is_available, total_rides, created_at,
        users:id (full_name, phone, avatar_url, rating, rating_count)
      `)
      .eq('id', userId)
      .single();

    if (error || !data) {
      res.status(404).json({ success: false, error: 'Sürücü profili bulunamadı.' });
      return;
    }

    res.json({ success: true, data });
  } catch {
    res.status(500).json({ success: false, error: 'Sürücü profili alınamadı.' });
  }
});

// Yakındaki müsait sürücüleri listele (yalnızca müşteriler için)
router.get('/nearby', roleMiddleware(['customer']), async (req: Request, res: Response) => {
  try {
    const lat = parseFloat(req.query.lat as string);
    const lng = parseFloat(req.query.lng as string);
    const rawRadius = parseInt(req.query.radius as string) || 5000;
    const radius = Math.min(rawRadius, 10_000); // en fazla 10 km

    if (isNaN(lat) || isNaN(lng)) {
      res.status(400).json({ success: false, error: 'Geçerli lat ve lng parametreleri gerekli.' });
      return;
    }

    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      res.status(400).json({ success: false, error: 'Koordinatlar geçerli aralıkta değil.' });
      return;
    }

    // PostGIS fonksiyonu ile yakın sürücüleri bul
    const { data, error } = await supabaseAdmin.rpc('find_nearby_drivers', {
      lat,
      lng,
      radius_meters: radius,
      max_results: 10,
    });

    if (error) {
      res.status(500).json({ success: false, error: 'Yakın sürücüler bulunamadı.' });
      return;
    }

    res.json({ success: true, data: data || [] });
  } catch {
    res.status(500).json({ success: false, error: 'Sürücü arama sırasında hata oluştu.' });
  }
});

// Sürücü numarasıyla ara (favori sürücü ekleme akışı — telefon numarası kullanılmaz)
router.get('/by-code/:code', roleMiddleware(['customer']), async (req: Request, res: Response) => {
  try {
    const code = (req.params.code || '').trim();
    if (!/^\d{4}$/.test(code)) {
      res.status(404).json({ success: false, error: 'Sürücü bulunamadı.' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('drivers')
      .select(`
        id, vehicle_plate, vehicle_model, vehicle_color, is_online,
        users:id (full_name, rating, rating_count)
      `)
      .eq('driver_code', code)
      .single();

    if (error || !data) {
      // Format geçerli ama eşleşme yok — var/yok ayrımı yapmadan aynı jenerik mesaj (enumeration'a ipucu vermemek için)
      res.status(404).json({ success: false, error: 'Sürücü bulunamadı.' });
      return;
    }

    res.json({ success: true, data });
  } catch {
    res.status(500).json({ success: false, error: 'Sürücü aranırken hata oluştu.' });
  }
});

// Sürücü online/offline durumunu güncelle
router.patch('/status', roleMiddleware(['driver']), async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { is_online } = req.body;

    if (typeof is_online !== 'boolean') {
      res.status(400).json({ success: false, error: 'is_online boolean değer olmalı.' });
      return;
    }

    if (is_online) {
      const bal = await fetchDriverBalance(userId);
      if (!canDriverTurnOnline(bal)) {
        const minB = getPlatformSettings().minDriverOnlineBalanceTcoin;
        res.status(403).json({
          success: false,
          error: `Çevrimiçi olmak için en az ${minB} T Coin gerekir. Mevcut: ${bal.toFixed(0)} T.`,
          code: 'INSUFFICIENT_BALANCE_FOR_ONLINE',
          minBalance: minB,
          balance: bal,
        });
        return;
      }
    }

    const updateData: Record<string, boolean> = {
      is_online,
      // Çevrimdışı olunca müsaitlik de kapanır
      is_available: is_online ? true : false,
    };

    const { data, error } = await supabaseAdmin
      .from('drivers')
      .update(updateData)
      .eq('id', userId)
      .select('id, is_online, is_available')
      .single();

    if (error) {
      res.status(500).json({ success: false, error: 'Durum güncellenemedi.' });
      return;
    }

    res.json({
      success: true,
      data,
      message: is_online ? 'Çevrimiçi oldunuz.' : 'Çevrimdışı oldunuz.',
    });
  } catch {
    res.status(500).json({ success: false, error: 'Durum güncellenirken hata oluştu.' });
  }
});

// Sürücünün yolculuk istatistikleri
router.get('/stats', roleMiddleware(['driver']), async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;

    const { data, error } = await supabaseAdmin.rpc('get_ride_stats', {
      p_user_id: userId,
    });

    if (error) {
      res.status(500).json({ success: false, error: 'İstatistikler alınamadı.' });
      return;
    }

    res.json({ success: true, data: data?.[0] || null });
  } catch {
    res.status(500).json({ success: false, error: 'İstatistikler alınırken hata oluştu.' });
  }
});

/** Ödeme entegrasyonu öncesi: kart yükleme simülasyonu — bakiyeye yazar (gerçek tahsilat yok). */
router.post('/wallet/simulate-card-topup', roleMiddleware(['driver']), async (req: Request, res: Response) => {
  try {
    if (!getPlatformSettings().walletCardSimulationEnabled) {
      res.status(403).json({
        success: false,
        error: 'Kart ile yükleme simülasyonu bu sunucuda kapalı.',
      });
      return;
    }

    const userId = req.user!.userId;
    const raw = (req.body as { amount?: unknown }).amount;
    const amount = typeof raw === 'number' ? raw : Number(raw);

    if (!Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ success: false, error: 'Geçerli pozitif bir tutar girin.' });
      return;
    }

    const rounded = Math.round(amount * 100) / 100;
    if (rounded > 100_000) {
      res.status(400).json({ success: false, error: 'Tek işlemde en fazla 100.000 T Coin yüklenebilir.' });
      return;
    }

    const { error: rpcError } = await supabaseAdmin.rpc('add_driver_balance', {
      p_driver_id: userId,
      p_amount: rounded,
    });

    if (rpcError) {
      logger.error('[WalletSim] add_driver_balance:', rpcError);
      res.status(500).json({ success: false, error: 'Bakiye güncellenemedi.' });
      return;
    }

    const { data: driver, error: driverErr } = await supabaseAdmin
      .from('drivers')
      .select('balance')
      .eq('id', userId)
      .single();

    if (driverErr || !driver) {
      res.status(500).json({ success: false, error: 'Güncel bakiye okunamadı.' });
      return;
    }

    const balance = Number((driver as { balance?: number }).balance ?? 0);
    logger.info(`[WalletSim] driver=${userId} amount=${rounded} new_balance=${balance}`);

    res.json({
      success: true,
      data: {
        balance,
        credited: rounded,
        simulation: true,
      },
    });
  } catch {
    res.status(500).json({ success: false, error: 'Simülasyon sırasında hata oluştu.' });
  }
});

export { router as driverRoutes };
