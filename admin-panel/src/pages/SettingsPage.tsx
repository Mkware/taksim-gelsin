import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Card,
  Group,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import * as adminApi from '../api/admin';
import { getErrorMessage } from '../api/client';
import type { PlatformSettings, PricingSettings } from '../types/api';

type BroadcastAudience = 'all' | 'customers' | 'drivers' | 'user';

interface BroadcastTemplate {
  label: string;
  title: string;
  body: string;
  audience?: BroadcastAudience;
}

const BROADCAST_TEMPLATES: BroadcastTemplate[] = [
  { label: '🚦 Yoğun saat', title: 'Yoğun saatler 📈', body: 'Şu an talep yoğun! Lütfen çevrimiçi olun — yolcular sizi bekliyor. 🚕💨', audience: 'drivers' },
  { label: '🟢 Çevrimiçi ol', title: 'Çevrimiçi olun 🟢', body: 'Bölgede çağrı var. Uygulamayı açıp çevrimiçi kalın, kazanç kaçmasın! 💰', audience: 'drivers' },
  { label: '☀️ Günaydın', title: 'Günaydın ☀️', body: 'İyi günler! Bugün yoğun olabilir — erken çevrimiçi olan sürücüler öne çıkar. 🚕', audience: 'drivers' },
  { label: '🌙 Gece turu', title: 'Gece turu başladı 🌙', body: 'Gece saatlerinde talep artıyor. Çevrimiçi kal, güvenli sürüş! 🌃🚕', audience: 'drivers' },
  { label: '🔋 T-Coin', title: 'Bakiye hatırlatması 🔋', body: 'Çevrimiçi olmak için yeterli T-Coin bakiyeniz olsun. Cüzdanınızı kontrol edin. 💳', audience: 'drivers' },
  { label: '🚕 Hızlı taksi', title: 'Taksi bir dokunuş uzağında 🚕', body: 'İhtiyacın olduğunda Taksim Gelsin yanında. Hemen çağır, sürücün gelsin! ✨', audience: 'customers' },
  { label: '🎁 Kampanya', title: 'Sana özel fırsat 🎁', body: 'Bu hafta yoğun saatlerde hızlı eşleşme! Uygulamayı aç, yolculuğunu başlat. 🎉', audience: 'customers' },
  { label: '⏱️ Kısa bekleme', title: 'Dakikalar içinde kapında ⏱️', body: 'Çevrimdeki sürücülerle kısa bekleme süresi. Şimdi taksi çağır! 📍', audience: 'customers' },
  { label: '📢 Duyuru', title: 'Önemli duyuru 📢', body: 'Taksim Gelsin ailesi için bilgilendirme. Detaylar uygulama içinde. ℹ️', audience: 'all' },
  { label: '🔧 Bakım', title: 'Planlı bakım 🔧', body: 'Kısa süreli bakım yapılabilir. Sorun yaşarsanız destek hattımız yanınızda. 🙏', audience: 'all' },
  { label: '🙏 Teşekkür', title: 'Teşekkürler 🙏', body: 'Bizi tercih ettiğiniz için teşekkürler! İyi yolculuklar dileriz. ❤️', audience: 'all' },
];

function PlatformSettingsSection() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ['admin', 'settings', 'platform'], queryFn: adminApi.getPlatformSettings });
  const [form, setForm] = useState<PlatformSettings | null>(null);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const mutation = useMutation({
    mutationFn: (patch: Partial<PlatformSettings>) => adminApi.updatePlatformSettings(patch),
    onSuccess: (next) => {
      notifications.show({ color: 'green', message: 'Platform ayarları kaydedildi.' });
      queryClient.setQueryData(['admin', 'settings', 'platform'], next);
    },
    onError: (err) => notifications.show({ color: 'red', message: getErrorMessage(err) }),
  });

  if (!form) return null;

  return (
    <Card withBorder radius="md" p="lg">
      <Title order={4} mb="md">
        Platform Ayarları
      </Title>
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
        <NumberInput
          label="Kabul ücreti (%)"
          value={form.rideAcceptFeePercent}
          onChange={(v) => setForm({ ...form, rideAcceptFeePercent: Number(v) || 0 })}
        />
        <NumberInput
          label="Min. çevrimiçi bakiye (T Coin)"
          value={form.minDriverOnlineBalanceTcoin}
          onChange={(v) => setForm({ ...form, minDriverOnlineBalanceTcoin: Number(v) || 0 })}
        />
        <NumberInput
          label="Alım noktası maskeleme yarıçapı (m)"
          value={form.pickupMaskRadiusM}
          onChange={(v) => setForm({ ...form, pickupMaskRadiusM: Number(v) || 0 })}
        />
        <NumberInput
          label="Eşleştirme matrisi max sürücü"
          min={4}
          max={20}
          value={form.matchingRoadMatrixMaxDrivers}
          onChange={(v) => setForm({ ...form, matchingRoadMatrixMaxDrivers: Number(v) || 0 })}
        />
        <NumberInput
          label="Mesafe önbellek TTL (sn)"
          min={60}
          max={3600}
          value={form.drivingDistanceCacheTtlSec}
          onChange={(v) => setForm({ ...form, drivingDistanceCacheTtlSec: Number(v) || 0 })}
        />
        <NumberInput
          label="Sürücü yanıt süresi (sn)"
          min={5}
          max={180}
          value={form.driverResponseTimeoutSeconds}
          onChange={(v) => setForm({ ...form, driverResponseTimeoutSeconds: Number(v) || 0 })}
        />
      </SimpleGrid>
      <Title order={5} mt="lg" mb="xs">
        Taksi Tarifesi
      </Title>
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
        <NumberInput
          label="Açılış ücreti (TL)"
          min={0}
          value={form.tariffBaseFare}
          onChange={(v) => setForm({ ...form, tariffBaseFare: Number(v) || 0 })}
        />
        <NumberInput
          label="KM başı ücret (TL)"
          min={0}
          value={form.tariffPerKmRate}
          onChange={(v) => setForm({ ...form, tariffPerKmRate: Number(v) || 0 })}
        />
        <NumberInput
          label="Taksimetre tabanı — minimum ücret (TL)"
          min={0}
          value={form.tariffMinimumFare}
          onChange={(v) => setForm({ ...form, tariffMinimumFare: Number(v) || 0 })}
        />
        <NumberInput
          label="Bekleme — dakika başı (TL)"
          min={0}
          value={form.tariffWaitingRatePerMinute}
          onChange={(v) => setForm({ ...form, tariffWaitingRatePerMinute: Number(v) || 0 })}
        />
      </SimpleGrid>
      <Switch
        mt="md"
        label="Kart ile bakiye yükleme simülasyonu (yalnızca test ortamı)"
        checked={form.walletCardSimulationEnabled}
        onChange={(e) => setForm({ ...form, walletCardSimulationEnabled: e.currentTarget.checked })}
      />
      <Button mt="md" loading={mutation.isPending} onClick={() => mutation.mutate(form)}>
        Kaydet
      </Button>
    </Card>
  );
}

function PricingSettingsSection() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ['admin', 'settings', 'pricing'], queryFn: adminApi.getPricingSettings });
  const [form, setForm] = useState<PricingSettings | null>(null);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const mutation = useMutation({
    mutationFn: (patch: PricingSettings) => adminApi.updatePricingSettings(patch),
    onSuccess: (next) => {
      notifications.show({ color: 'green', message: 'Fiyatlandırma kaydedildi.' });
      queryClient.setQueryData(['admin', 'settings', 'pricing'], next);
    },
    onError: (err) => notifications.show({ color: 'red', message: getErrorMessage(err) }),
  });

  if (!form) return null;

  return (
    <Card withBorder radius="md" p="lg">
      <Title order={4} mb="md">
        Fiyatlandırma
      </Title>
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
        <NumberInput
          label="Günlük giriş ücreti"
          value={form.entryDaily}
          onChange={(v) => setForm({ ...form, entryDaily: Number(v) || 0 })}
        />
        <NumberInput
          label="Haftalık giriş ücreti"
          value={form.entryWeekly}
          onChange={(v) => setForm({ ...form, entryWeekly: Number(v) || 0 })}
        />
        <NumberInput
          label="Aylık giriş ücreti"
          value={form.entryMonthly}
          onChange={(v) => setForm({ ...form, entryMonthly: Number(v) || 0 })}
        />
        <NumberInput
          label="Komisyon (%)"
          value={form.commissionPercent}
          onChange={(v) => setForm({ ...form, commissionPercent: Number(v) || 0 })}
        />
        <NumberInput
          label="Sabit komisyon"
          value={form.commissionFlat}
          onChange={(v) => setForm({ ...form, commissionFlat: Number(v) || 0 })}
        />
        <NumberInput
          label="Min. komisyon"
          value={form.minCommission}
          onChange={(v) => setForm({ ...form, minCommission: Number(v) || 0 })}
        />
      </SimpleGrid>
      <Button mt="md" loading={mutation.isPending} onClick={() => mutation.mutate(form)}>
        Kaydet
      </Button>
    </Card>
  );
}

function BroadcastSection() {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<BroadcastAudience>('all');
  const [phone, setPhone] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      adminApi.sendBroadcastPush({
        title,
        body,
        audience,
        phone: audience === 'user' ? phone : undefined,
      }),
    onSuccess: (result) => {
      notifications.show({
        color: 'green',
        message: `Gönderildi: ${result.successCount}/${result.totalTokens} cihaz.`,
      });
      setTitle('');
      setBody('');
    },
    onError: (err) => notifications.show({ color: 'red', message: getErrorMessage(err) }),
  });

  function applyTemplate(t: BroadcastTemplate) {
    setTitle(t.title);
    setBody(t.body);
    if (t.audience) setAudience(t.audience);
  }

  function handleSend() {
    const confirmMsg =
      audience === 'user'
        ? `"${title}" bildirimi ${phone} numarasına gönderilecek. Onaylıyor musunuz?`
        : `"${title}" bildirimi ${audience.toUpperCase()} hedef kitlesine gönderilecek. Onaylıyor musunuz?`;
    if (confirm(confirmMsg)) {
      mutation.mutate();
    }
  }

  return (
    <Card withBorder radius="md" p="lg">
      <Title order={4} mb="md">
        Bildirim Yayınla
      </Title>
      <Group gap="xs" mb="md">
        {BROADCAST_TEMPLATES.map((t) => (
          <Button key={t.label} size="xs" variant="light" onClick={() => applyTemplate(t)}>
            {t.label}
          </Button>
        ))}
      </Group>
      <Stack gap="sm">
        <TextInput label="Başlık" maxLength={80} value={title} onChange={(e) => setTitle(e.currentTarget.value)} />
        <Textarea label="İçerik" maxLength={500} value={body} onChange={(e) => setBody(e.currentTarget.value)} />
        <Select
          label="Hedef kitle"
          value={audience}
          onChange={(v) => setAudience((v as BroadcastAudience) ?? 'all')}
          data={[
            { value: 'all', label: 'Herkes' },
            { value: 'customers', label: 'Yolcular' },
            { value: 'drivers', label: 'Sürücüler' },
            { value: 'user', label: 'Tek kişi (telefon)' },
          ]}
        />
        {audience === 'user' && (
          <TextInput
            label="Telefon"
            placeholder="+905551112233"
            value={phone}
            onChange={(e) => setPhone(e.currentTarget.value)}
          />
        )}
        <Text size="xs" c="dimmed">
          "Herkes/Yolcular/Sürücüler" seçiminde binlerce cihaza ulaşabilir — göndermeden önce kontrol edin.
        </Text>
        <Button
          color="orange"
          loading={mutation.isPending}
          disabled={!title || !body || (audience === 'user' && !phone)}
          onClick={handleSend}
        >
          Gönder
        </Button>
      </Stack>
    </Card>
  );
}

export function SettingsPage() {
  return (
    <div>
      <Title order={3} mb="md">
        Ayarlar
      </Title>
      <Stack gap="md">
        <PlatformSettingsSection />
        <PricingSettingsSection />
        <BroadcastSection />
      </Stack>
    </div>
  );
}
