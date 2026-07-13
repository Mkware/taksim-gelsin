import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Group,
  Modal,
  Select,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconSearch } from '@tabler/icons-react';
import dayjs from 'dayjs';
import * as adminApi from '../api/admin';
import { getErrorMessage } from '../api/client';
import type { RideItem, RideStatus } from '../types/api';

const RIDES_KEY = ['admin', 'rides'];

const STATUS_OPTIONS: Array<{ value: RideStatus | 'all'; label: string }> = [
  { value: 'all', label: 'Tümü' },
  { value: 'searching', label: 'Aranıyor' },
  { value: 'accepted', label: 'Kabul edildi' },
  { value: 'arriving', label: 'Geliyor' },
  { value: 'in_progress', label: 'Devam ediyor' },
  { value: 'completed', label: 'Tamamlandı' },
  { value: 'cancelled', label: 'İptal edildi' },
];

const STATUS_COLORS: Record<RideStatus, string> = {
  searching: 'yellow',
  accepted: 'blue',
  arriving: 'blue',
  in_progress: 'cyan',
  completed: 'green',
  cancelled: 'red',
};

export function RidesPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<RideStatus | 'all'>('all');
  const [detailOpened, { open: openDetail, close: closeDetail }] = useDisclosure();
  const [selected, setSelected] = useState<RideItem | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  const { data: rides, isLoading } = useQuery({
    queryKey: [...RIDES_KEY, search, status],
    queryFn: () => adminApi.getRides({ q: search || undefined, status }),
  });

  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => adminApi.cancelRide(id, reason),
    onSuccess: () => {
      notifications.show({ color: 'green', message: 'Yolculuk iptal edildi.' });
      void queryClient.invalidateQueries({ queryKey: RIDES_KEY });
      closeDetail();
    },
    onError: (err) => notifications.show({ color: 'red', message: getErrorMessage(err) }),
  });

  function openRideDetail(ride: RideItem) {
    setSelected(ride);
    setCancelReason('');
    openDetail();
  }

  return (
    <div>
      <Title order={3} mb="md">
        Yolculuklar
      </Title>

      <Group mb="md" wrap="wrap">
        <TextInput
          placeholder="Ad, telefon veya adres ara…"
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          w={280}
        />
        <Select
          value={status}
          onChange={(v) => setStatus((v as RideStatus | 'all') ?? 'all')}
          data={STATUS_OPTIONS}
          w={200}
        />
      </Group>

      <Table.ScrollContainer minWidth={650}>
        <Table verticalSpacing="sm" striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Müşteri</Table.Th>
              <Table.Th visibleFrom="sm">Sürücü</Table.Th>
              <Table.Th visibleFrom="md">Kalkış</Table.Th>
              <Table.Th>Durum</Table.Th>
              <Table.Th>Fiyat</Table.Th>
              <Table.Th visibleFrom="sm">Talep zamanı</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(rides ?? []).map((ride) => (
              <Table.Tr key={ride.id}>
                <Table.Td>
                  <Text fw={500}>{ride.customer_name ?? '—'}</Text>
                  <Text size="xs" c="dimmed" hiddenFrom="sm">
                    {ride.driver_name ?? '—'}
                  </Text>
                </Table.Td>
                <Table.Td visibleFrom="sm">{ride.driver_name ?? '—'}</Table.Td>
                <Table.Td visibleFrom="md" style={{ maxWidth: 220 }}>
                  <Text truncate>{ride.pickup_address}</Text>
                </Table.Td>
                <Table.Td>
                  <Badge color={STATUS_COLORS[ride.status]} variant="light">
                    {STATUS_OPTIONS.find((o) => o.value === ride.status)?.label ?? ride.status}
                  </Badge>
                </Table.Td>
                <Table.Td>{(ride.final_price ?? ride.estimated_price ?? 0).toFixed(2)} ₺</Table.Td>
                <Table.Td visibleFrom="sm">{dayjs(ride.requested_at).format('DD.MM.YYYY HH:mm')}</Table.Td>
                <Table.Td>
                  <Button size="xs" variant="light" onClick={() => openRideDetail(ride)}>
                    Detay
                  </Button>
                </Table.Td>
              </Table.Tr>
            ))}
            {!isLoading && (rides ?? []).length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={7}>
                  <Text c="dimmed" ta="center">
                    Sonuç bulunamadı.
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

      <Modal opened={detailOpened} onClose={closeDetail} title="Yolculuk detayı" size="lg">
        {selected && (
          <Stack gap="xs">
            <Text>
              <b>Müşteri:</b> {selected.customer_name ?? '—'} ({selected.customer_phone ?? '—'})
            </Text>
            <Text>
              <b>Sürücü:</b> {selected.driver_name ?? '—'} ({selected.driver_phone ?? '—'})
            </Text>
            <Text>
              <b>Kalkış:</b> {selected.pickup_address}
            </Text>
            <Text>
              <b>Varış:</b> {selected.dropoff_address}
            </Text>
            <Text>
              <b>Mesafe:</b> {selected.distance_km?.toFixed(1) ?? '—'} km
            </Text>
            <Text>
              <b>Fiyat:</b> {(selected.final_price ?? selected.estimated_price ?? 0).toFixed(2)} ₺
            </Text>
            <Text>
              <b>Durum:</b> {STATUS_OPTIONS.find((o) => o.value === selected.status)?.label}
            </Text>
            {selected.cancel_reason && (
              <Text>
                <b>İptal nedeni:</b> {selected.cancel_reason}
              </Text>
            )}

            {selected.can_cancel && (
              <Stack gap="xs" mt="md">
                <Textarea
                  label="İptal nedeni (opsiyonel)"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.currentTarget.value)}
                />
                <Button
                  color="red"
                  variant="light"
                  loading={cancelMutation.isPending}
                  onClick={() => cancelMutation.mutate({ id: selected.id, reason: cancelReason || undefined })}
                >
                  Yolculuğu iptal et
                </Button>
              </Stack>
            )}
          </Stack>
        )}
      </Modal>
    </div>
  );
}
