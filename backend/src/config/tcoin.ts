/**
 * T Coin ile ilgili değerler artık `platform_settings` + env varsayılanlarından gelir.
 * Doğrudan sabit import etmeyin; `getPlatformSettings()` kullanın.
 */

export {
  getPlatformSettings,
  getPublicPlatformConfig,
  initPlatformSettings,
  refreshPlatformSettings,
  updatePlatformSettings,
  type PlatformOperationalSettings,
  type PlatformSettingsPatch,
} from '../services/platform_settings.service';
