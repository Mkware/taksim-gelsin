import { useQuery } from '@tanstack/react-query';
import { ActionIcon, Card, Group, SimpleGrid, Skeleton, Text, ThemeIcon, Title, Tooltip } from '@mantine/core';
import {
  IconCalendarStats,
  IconCar,
  IconCoin,
  IconRefresh,
  IconRoute,
  IconUsers,
  type IconProps,
} from '@tabler/icons-react';
import type { ComponentType } from 'react';
import { getOverview } from '../api/admin';

function formatCurrency(value: number): string {
  return `${value.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`;
}

const METRICS: Array<{
  key: 'users' | 'drivers' | 'activeRides' | 'completedToday' | 'revenueToday' | 'revenueMonth';
  label: string;
  icon: ComponentType<IconProps>;
  color: string;
  format?: (v: number) => string;
}> = [
  { key: 'users', label: 'Toplam Müşteri', icon: IconUsers, color: 'blue' },
  { key: 'drivers', label: 'Toplam Sürücü', icon: IconCar, color: 'grape' },
  { key: 'activeRides', label: 'Aktif Yolculuk', icon: IconRoute, color: 'teal' },
  { key: 'completedToday', label: 'Bugün Tamamlanan', icon: IconCalendarStats, color: 'indigo' },
  { key: 'revenueToday', label: 'Bugünkü Gelir', icon: IconCoin, color: 'brandAmber', format: formatCurrency },
  { key: 'revenueMonth', label: 'Bu Ayki Gelir', icon: IconCoin, color: 'orange', format: formatCurrency },
];

export function OverviewPage() {
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['admin', 'overview'],
    queryFn: getOverview,
  });

  return (
    <div>
      <Group justify="space-between" mb="lg">
        <Title order={3}>Genel Bakış</Title>
        <Tooltip label="Yenile">
          <ActionIcon variant="light" size="lg" loading={isFetching} onClick={() => refetch()}>
            <IconRefresh size={18} />
          </ActionIcon>
        </Tooltip>
      </Group>

      {isError && (
        <Text c="red" mb="md">
          Genel durum bilgisi alınamadı.
        </Text>
      )}

      <SimpleGrid cols={{ base: 1, xs: 2, lg: 3 }} spacing="md">
        {METRICS.map((metric) => (
          <Card key={metric.key} withBorder radius="md" padding="lg">
            <Group justify="space-between" align="flex-start">
              <div>
                <Text size="sm" c="dimmed" mb={4}>
                  {metric.label}
                </Text>
                {isLoading || !data ? (
                  <Skeleton height={30} width={90} />
                ) : (
                  <Text fw={700} fz={26}>
                    {metric.format ? metric.format(data[metric.key]) : data[metric.key]}
                  </Text>
                )}
              </div>
              <ThemeIcon color={metric.color} variant="light" size={42} radius="md">
                <metric.icon size={22} stroke={1.75} />
              </ThemeIcon>
            </Group>
          </Card>
        ))}
      </SimpleGrid>
    </div>
  );
}
