import { Router, Request, Response } from 'express';
import { getPublicPlatformConfig } from '../../services/platform_settings.service';

const router = Router();

/**
 * Uygulama (sürücü/müşteri) — sunucudaki operasyon eşiklerini okur; kimlik gerekmez.
 */
router.get('/public', (_req: Request, res: Response) => {
  try {
    res.json({ success: true, data: getPublicPlatformConfig() });
  } catch {
    res.status(500).json({ success: false, error: 'Yapılandırma alınamadı.' });
  }
});

export { router as configRoutes };
