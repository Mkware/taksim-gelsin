import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge, Group, Pagination, Select, Table, Text, Title } from '@mantine/core';
import dayjs from 'dayjs';
import { useSearchParams } from 'react-router-dom';
import { getWalletTransactions } from '../api/admin';
import type { WalletTransactionType } from '../types/api';

const TYPE_LABELS: Record<WalletTransactionType, string> = {
  accept_fee: 'Kabul ücreti',
  refund: 'İade',
  admin_topup: 'Admin yükleme',
  admin_adjust: 'Admin düzeltme',
  card_topup: 'Kart yükleme',
};

const TYPE_COLORS: Record<WalletTransactionType, string> = {
  accept_fee: 'red',
  refund: 'blue',
  admin_topup: 'green',
  admin_adjust: 'orange',
  card_topup: 'teal',
};

export function WalletLedgerPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const driverId = searchParams.get('driverId') ?? undefined;
  const [type, setType] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'wallet-transactions', driverId, type, page],
    queryFn: () => getWalletTransactions({ driverId, type: type ?? undefined, page, limit: 50 }),
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <div>
      <Title order={3} mb="md">
        Cüzdan Hareketleri
      </Title>

      <Group mb="md" gap="sm">
        {driverId && (
          <Badge
            variant="light"
            style={{ cursor: 'pointer' }}
            onClick={() => {
              setSearchParams({});
              setPage(1);
            }}
          >
            Sürücü filtresi aktif — kaldır ✕
          </Badge>
        )}
        <Select
          placeholder="Tüm tipler"
          clearable
          data={Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label }))}
          value={type}
          onChange={(v) => {
            setType(v);
            setPage(1);
          }}
          w={220}
        />
      </Group>

      <Table.ScrollContainer minWidth={800}>
        <Table verticalSpacing="sm" striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Tarih</Table.Th>
              <Table.Th>Sürücü</Table.Th>
              <Table.Th>Tip</Table.Th>
              <Table.Th>Tutar</Table.Th>
              <Table.Th>Bakiye (sonrası)</Table.Th>
              <Table.Th>Not</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(data?.items ?? []).map((tx) => (
              <Table.Tr key={tx.id}>
                <Table.Td>
                  <Text size="sm">{dayjs(tx.created_at).format('DD.MM.YYYY HH:mm')}</Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{tx.driver?.full_name ?? '—'}</Text>
                  <Text size="xs" c="dimmed">
                    {tx.driver?.vehicle_plate ?? tx.driver_id}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Badge color={TYPE_COLORS[tx.type]} variant="light">
                    {TYPE_LABELS[tx.type] ?? tx.type}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Text c={tx.amount < 0 ? 'red' : 'green'} fw={500}>
                    {tx.amount > 0 ? '+' : ''}
                    {tx.amount.toFixed(2)} T
                  </Text>
                </Table.Td>
                <Table.Td>{tx.balance_after != null ? `${tx.balance_after.toFixed(2)} T` : '—'}</Table.Td>
                <Table.Td>
                  <Text size="sm" c="dimmed">
                    {tx.reason ?? '—'}
                  </Text>
                </Table.Td>
              </Table.Tr>
            ))}
            {!isLoading && (data?.items ?? []).length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={6}>
                  <Text c="dimmed" ta="center">
                    Kayıt bulunamadı.
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

      {totalPages > 1 && (
        <Group justify="center" mt="md">
          <Pagination value={page} onChange={setPage} total={totalPages} />
        </Group>
      )}
    </div>
  );
}
