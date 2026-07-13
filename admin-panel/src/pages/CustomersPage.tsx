import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Group,
  Modal,
  PasswordInput,
  SegmentedControl,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconSearch } from '@tabler/icons-react';
import * as adminApi from '../api/admin';
import { getErrorMessage } from '../api/client';
import type { CustomerItem } from '../types/api';

const CUSTOMERS_KEY = ['admin', 'customers'];

export function CustomersPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [suspendedFilter, setSuspendedFilter] = useState<'all' | 'true' | 'false'>('all');
  const [detailOpened, { open: openDetail, close: closeDetail }] = useDisclosure();
  const [passwordOpened, { open: openPassword, close: closePassword }] = useDisclosure();
  const [selected, setSelected] = useState<CustomerItem | null>(null);
  const [newPassword, setNewPassword] = useState('');

  const { data: customers, isLoading } = useQuery({
    queryKey: [...CUSTOMERS_KEY, search, suspendedFilter],
    queryFn: () => adminApi.getCustomers({ q: search || undefined, suspended: suspendedFilter }),
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: CUSTOMERS_KEY });
  }

  const suspendMutation = useMutation({
    mutationFn: ({ id, is_suspended }: { id: string; is_suspended: boolean }) =>
      adminApi.updateCustomer(id, { is_suspended }),
    onSuccess: () => {
      notifications.show({ color: 'green', message: 'Müşteri güncellendi.' });
      invalidate();
      closeDetail();
    },
    onError: (err) => notifications.show({ color: 'red', message: getErrorMessage(err) }),
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => adminApi.revokeCustomerSessions(id),
    onSuccess: () => notifications.show({ color: 'green', message: 'Oturumlar sonlandırıldı.' }),
    onError: (err) => notifications.show({ color: 'red', message: getErrorMessage(err) }),
  });

  const resetPasswordMutation = useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) =>
      adminApi.resetCustomerPassword(id, password),
    onSuccess: () => {
      notifications.show({ color: 'green', message: 'Şifre güncellendi.' });
      closePassword();
      setNewPassword('');
    },
    onError: (err) => notifications.show({ color: 'red', message: getErrorMessage(err) }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminApi.deleteCustomer(id),
    onSuccess: () => {
      notifications.show({ color: 'green', message: 'Müşteri silindi.' });
      invalidate();
      closeDetail();
    },
    onError: (err) => notifications.show({ color: 'red', message: getErrorMessage(err) }),
  });

  function openCustomerDetail(customer: CustomerItem) {
    setSelected(customer);
    openDetail();
  }

  return (
    <div>
      <Title order={3} mb="md">
        Müşteriler
      </Title>

      <Group mb="md" wrap="wrap">
        <TextInput
          placeholder="Ad veya telefon ara…"
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          w={280}
        />
        <SegmentedControl
          value={suspendedFilter}
          onChange={(v) => setSuspendedFilter(v as 'all' | 'true' | 'false')}
          data={[
            { label: 'Tümü', value: 'all' },
            { label: 'Aktif', value: 'false' },
            { label: 'Askıda', value: 'true' },
          ]}
        />
      </Group>

      <Table.ScrollContainer minWidth={600}>
        <Table verticalSpacing="sm" striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Ad</Table.Th>
              <Table.Th visibleFrom="sm">Telefon</Table.Th>
              <Table.Th visibleFrom="md">Puan</Table.Th>
              <Table.Th visibleFrom="md">Tamamlanan</Table.Th>
              <Table.Th>Durum</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(customers ?? []).map((customer) => (
              <Table.Tr key={customer.id}>
                <Table.Td>
                  <Text fw={500}>{customer.full_name}</Text>
                  <Text size="xs" c="dimmed" hiddenFrom="sm">
                    {customer.phone}
                  </Text>
                </Table.Td>
                <Table.Td visibleFrom="sm">{customer.phone}</Table.Td>
                <Table.Td visibleFrom="md">{customer.rating?.toFixed(1) ?? '—'}</Table.Td>
                <Table.Td visibleFrom="md">{customer.completed_rides}</Table.Td>
                <Table.Td>
                  <Group gap={4} wrap="nowrap">
                    <Badge color={customer.is_suspended ? 'red' : 'green'} variant="light">
                      {customer.is_suspended ? 'Askıda' : 'Aktif'}
                    </Badge>
                    {customer.has_active_ride && (
                      <Badge color="blue" variant="light" visibleFrom="sm">
                        Aktif
                      </Badge>
                    )}
                  </Group>
                </Table.Td>
                <Table.Td>
                  <Button size="xs" variant="light" onClick={() => openCustomerDetail(customer)}>
                    Detay
                  </Button>
                </Table.Td>
              </Table.Tr>
            ))}
            {!isLoading && (customers ?? []).length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={6}>
                  <Text c="dimmed" ta="center">
                    Sonuç bulunamadı.
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

      <Modal opened={detailOpened} onClose={closeDetail} title={selected?.full_name ?? 'Müşteri'}>
        {selected && (
          <Stack gap="sm">
            <Text size="sm" c="dimmed">
              {selected.phone}
            </Text>
            <Group>
              <Button
                variant="light"
                color={selected.is_suspended ? 'green' : 'orange'}
                onClick={() =>
                  suspendMutation.mutate({ id: selected.id, is_suspended: !selected.is_suspended })
                }
                loading={suspendMutation.isPending}
              >
                {selected.is_suspended ? 'Askıyı kaldır' : 'Askıya al'}
              </Button>
              <Button
                variant="light"
                onClick={() => revokeMutation.mutate(selected.id)}
                loading={revokeMutation.isPending}
              >
                Oturumları kapat
              </Button>
              <Button variant="light" onClick={openPassword}>
                Şifre sıfırla
              </Button>
              <Button
                variant="light"
                color="red"
                onClick={() => {
                  if (confirm('Bu müşteriyi silmek istediğinize emin misiniz?')) {
                    deleteMutation.mutate(selected.id);
                  }
                }}
                loading={deleteMutation.isPending}
              >
                Sil
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      <Modal opened={passwordOpened} onClose={closePassword} title="Şifre sıfırla">
        <Stack gap="sm">
          <PasswordInput
            label="Yeni şifre"
            value={newPassword}
            onChange={(e) => setNewPassword(e.currentTarget.value)}
          />
          <Button
            loading={resetPasswordMutation.isPending}
            disabled={newPassword.length < 6}
            onClick={() => selected && resetPasswordMutation.mutate({ id: selected.id, password: newPassword })}
          >
            Kaydet
          </Button>
        </Stack>
      </Modal>
    </div>
  );
}
