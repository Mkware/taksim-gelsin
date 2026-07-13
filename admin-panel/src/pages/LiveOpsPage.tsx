import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, Group, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import dayjs from 'dayjs';
import * as adminApi from '../api/admin';
import { getErrorMessage } from '../api/client';

const HEALTH_KEY = ['admin', 'ops', 'health'];
const LIVE_KEY = ['admin', 'ops', 'live'];
const MATCHING_KEY = ['admin', 'ops', 'matching'];

function HealthBadge({ label, ok }: { label: string; ok: boolean }) {
  return (
    <Badge color={ok ? 'green' : 'red'} variant="light">
      {label}: {ok ? 'OK' : 'Hata'}
    </Badge>
  );
}

export function LiveOpsPage() {
  const queryClient = useQueryClient();

  const { data: health } = useQuery({
    queryKey: HEALTH_KEY,
    queryFn: adminApi.getOpsHealth,
    refetchInterval: 20_000,
  });

  const { data: live } = useQuery({
    queryKey: LIVE_KEY,
    queryFn: adminApi.getOpsLive,
    refetchInterval: 20_000,
  });

  const { data: matching } = useQuery({
    queryKey: MATCHING_KEY,
    queryFn: adminApi.getOpsMatching,
    refetchInterval: 20_000,
  });

  function invalidateAll() {
    void queryClient.invalidateQueries({ queryKey: LIVE_KEY });
    void queryClient.invalidateQueries({ queryKey: MATCHING_KEY });
    void queryClient.invalidateQueries({ queryKey: HEALTH_KEY });
  }

  const clearMutation = useMutation({
    mutationFn: (rideId: string) => adminApi.clearOpsMatching(rideId),
    onSuccess: () => {
      notifications.show({ color: 'green', message: 'Eşleştirme kuyruğu temizlendi.' });
      invalidateAll();
    },
    onError: (err) => notifications.show({ color: 'red', message: getErrorMessage(err) }),
  });

  const recoverMutation = useMutation({
    mutationFn: () => adminApi.recoverStaleSearching(),
    onSuccess: (res) => {
      notifications.show({ color: 'green', message: `${res.recovered} yolculuk kurtarıldı/iptal edildi.` });
      invalidateAll();
    },
    onError: (err) => notifications.show({ color: 'red', message: getErrorMessage(err) }),
  });

  return (
    <div>
      <Group justify="space-between" mb="md">
        <Title order={3}>Canlı Operasyon</Title>
        <Button
          size="xs"
          variant="light"
          loading={recoverMutation.isPending}
          onClick={() => recoverMutation.mutate()}
        >
          Eski aramaları kurtar
        </Button>
      </Group>

      {health && (
        <Group mb="lg" gap="xs">
          <HealthBadge label="Redis" ok={health.redis === 'ok'} />
          <HealthBadge label="Veritabanı" ok={health.database === 'ok'} />
          <Badge variant="light">Çevrimiçi sürücü: {health.onlineDriversSocket}</Badge>
          <Badge variant="light">Aranıyor: {health.searchingRides}</Badge>
        </Group>
      )}

      <Title order={4} mb="sm">
        Eşleştirme Kuyruğu
      </Title>
      <Stack gap="sm" mb="lg">
        {(matching ?? []).map((item) => (
          <Card key={item.id} withBorder radius="md" padding="sm">
            <Group justify="space-between">
              <div>
                <Text fw={600}>{item.customer_name ?? '—'}</Text>
                <Text size="xs" c="dimmed">
                  {item.pickup_address}
                </Text>
              </div>
              <Group gap="xs">
                <Badge variant="light">Kuyrukta: {item.matching.queueRemaining}</Badge>
                <Badge variant="light">Sorulan: {item.matching.driversAsked}</Badge>
                <Badge variant="light">Reddeden: {item.matching.rejectedDriverIds.length}</Badge>
                {item.matching.pendingDriverId && (
                  <Badge color="blue" variant="light">
                    Yanıt bekleniyor ({item.matching.offerSecondsLeft ?? '?'}sn)
                  </Badge>
                )}
                <Button
                  size="xs"
                  color="red"
                  variant="light"
                  loading={clearMutation.isPending}
                  onClick={() => clearMutation.mutate(item.id)}
                >
                  Kuyruğu temizle
                </Button>
              </Group>
            </Group>
          </Card>
        ))}
        {(matching ?? []).length === 0 && (
          <Text c="dimmed" size="sm">
            Şu an eşleştirme kuyruğunda yolculuk yok.
          </Text>
        )}
      </Stack>

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
        <div>
          <Title order={4} mb="sm">
            Aktif Yolculuklar ({live?.rides.length ?? 0})
          </Title>
          <Table.ScrollContainer minWidth={500}>
            <Table verticalSpacing="xs" striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Müşteri</Table.Th>
                  <Table.Th>Sürücü</Table.Th>
                  <Table.Th>Durum</Table.Th>
                  <Table.Th>Talep</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {(live?.rides ?? []).map((ride) => (
                  <Table.Tr key={ride.id}>
                    <Table.Td>{ride.customer_name ?? '—'}</Table.Td>
                    <Table.Td>{ride.driver_name ?? '—'}</Table.Td>
                    <Table.Td>
                      <Badge variant="light">{ride.status}</Badge>
                    </Table.Td>
                    <Table.Td>{dayjs(ride.requested_at).format('HH:mm:ss')}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </div>

        <div>
          <Title order={4} mb="sm">
            Çevrimiçi Sürücüler ({live?.drivers.length ?? 0})
          </Title>
          <Table.ScrollContainer minWidth={500}>
            <Table verticalSpacing="xs" striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Ad</Table.Th>
                  <Table.Th>Plaka</Table.Th>
                  <Table.Th>Müsait</Table.Th>
                  <Table.Th>Konum</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {(live?.drivers ?? []).map((driver) => (
                  <Table.Tr key={driver.id}>
                    <Table.Td>{driver.full_name ?? '—'}</Table.Td>
                    <Table.Td>{driver.vehicle_plate ?? '—'}</Table.Td>
                    <Table.Td>
                      <Badge color={driver.is_available ? 'green' : 'gray'} variant="light">
                        {driver.is_available ? 'Müsait' : 'Meşgul'}
                      </Badge>
                    </Table.Td>
                    <Table.Td>{driver.hasLocation ? 'Var' : '—'}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </div>
      </SimpleGrid>
    </div>
  );
}
