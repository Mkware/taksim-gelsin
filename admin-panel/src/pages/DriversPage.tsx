import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Modal,
  NumberInput,
  PasswordInput,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconArrowsSort,
  IconEdit,
  IconPlus,
  IconSortAscending,
  IconSortDescending,
  IconTrash,
  IconWallet,
} from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import * as adminApi from '../api/admin';
import { getErrorMessage } from '../api/client';
import type { DriverItem } from '../types/api';

const DRIVERS_KEY = ['admin', 'drivers'];

type PerformanceSortField = 'total_rides' | 'rating' | 'acceptance_rate';

function driverRating(driver: DriverItem): number {
  return driver.users?.rating ?? 0;
}

interface DriverFormValues {
  phone: string;
  full_name: string;
  password: string;
  vehicle_plate: string;
  vehicle_model: string;
  vehicle_color: string;
}

const EMPTY_FORM: DriverFormValues = {
  phone: '',
  full_name: '',
  password: '',
  vehicle_plate: '',
  vehicle_model: '',
  vehicle_color: '',
};

export function DriversPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: drivers, isLoading } = useQuery({ queryKey: DRIVERS_KEY, queryFn: adminApi.getDrivers });

  const [formOpened, { open: openForm, close: closeForm }] = useDisclosure();
  const [balanceOpened, { open: openBalance, close: closeBalance }] = useDisclosure();
  const [editing, setEditing] = useState<DriverItem | null>(null);
  const [balanceTarget, setBalanceTarget] = useState<DriverItem | null>(null);
  const [balanceAmount, setBalanceAmount] = useState<number | ''>('');
  const [balanceReason, setBalanceReason] = useState('');
  const [sortField, setSortField] = useState<PerformanceSortField>('total_rides');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const sortedDrivers = useMemo(() => {
    const list = [...(drivers ?? [])];
    const value = (d: DriverItem) => (sortField === 'rating' ? driverRating(d) : d[sortField] ?? 0);
    list.sort((a, b) => (value(a) - value(b)) * (sortDir === 'asc' ? 1 : -1));
    return list;
  }, [drivers, sortField, sortDir]);

  function toggleSort(field: PerformanceSortField) {
    if (field === sortField) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  }

  function SortableTh({ field, children }: { field: PerformanceSortField; children: ReactNode }) {
    const active = sortField === field;
    const Icon = active ? (sortDir === 'asc' ? IconSortAscending : IconSortDescending) : IconArrowsSort;
    return (
      <Table.Th>
        <UnstyledButton onClick={() => toggleSort(field)}>
          <Group gap={4} wrap="nowrap">
            <Text fw={500} size="sm">
              {children}
            </Text>
            <Icon size={14} color={active ? undefined : 'var(--mantine-color-dimmed)'} />
          </Group>
        </UnstyledButton>
      </Table.Th>
    );
  }

  const form = useForm<DriverFormValues>({ initialValues: EMPTY_FORM });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: DRIVERS_KEY });
  }

  const createMutation = useMutation({
    mutationFn: (input: adminApi.CreateDriverInput) => adminApi.createDriver(input),
    onSuccess: () => {
      notifications.show({ color: 'green', message: 'Sürücü oluşturuldu.' });
      invalidate();
      closeForm();
    },
    onError: (err) => notifications.show({ color: 'red', message: getErrorMessage(err) }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: adminApi.UpdateDriverInput }) => adminApi.updateDriver(id, patch),
    onSuccess: () => {
      notifications.show({ color: 'green', message: 'Sürücü güncellendi.' });
      invalidate();
      closeForm();
    },
    onError: (err) => notifications.show({ color: 'red', message: getErrorMessage(err) }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminApi.deleteDriver(id),
    onSuccess: () => {
      notifications.show({ color: 'green', message: 'Sürücü silindi.' });
      invalidate();
    },
    onError: (err) => notifications.show({ color: 'red', message: getErrorMessage(err) }),
  });

  const accessMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => adminApi.setDriverAccess(id, enabled),
    onSuccess: invalidate,
    onError: (err) => notifications.show({ color: 'red', message: getErrorMessage(err) }),
  });

  const balanceMutation = useMutation({
    mutationFn: ({ id, amount, reason }: { id: string; amount: number; reason?: string }) =>
      adminApi.addDriverBalance(id, amount, reason),
    onSuccess: () => {
      notifications.show({ color: 'green', message: 'Bakiye eklendi.' });
      invalidate();
      closeBalance();
    },
    onError: (err) => notifications.show({ color: 'red', message: getErrorMessage(err) }),
  });

  function openCreateForm() {
    setEditing(null);
    form.setValues(EMPTY_FORM);
    openForm();
  }

  function openEditForm(driver: DriverItem) {
    setEditing(driver);
    form.setValues({
      phone: driver.users?.phone ?? '',
      full_name: driver.users?.full_name ?? '',
      password: '',
      vehicle_plate: driver.vehicle_plate,
      vehicle_model: driver.vehicle_model,
      vehicle_color: driver.vehicle_color,
    });
    openForm();
  }

  function handleSubmit(values: DriverFormValues) {
    if (editing) {
      const patch: adminApi.UpdateDriverInput = {};
      if (values.full_name !== (editing.users?.full_name ?? '')) patch.full_name = values.full_name;
      if (values.phone !== (editing.users?.phone ?? '')) patch.phone = values.phone;
      if (values.vehicle_plate !== editing.vehicle_plate) patch.vehicle_plate = values.vehicle_plate;
      if (values.vehicle_model !== editing.vehicle_model) patch.vehicle_model = values.vehicle_model;
      if (values.vehicle_color !== editing.vehicle_color) patch.vehicle_color = values.vehicle_color;
      if (values.password) patch.password = values.password;
      updateMutation.mutate({ id: editing.id, patch });
    } else {
      createMutation.mutate(values);
    }
  }

  function openBalanceDialog(driver: DriverItem) {
    setBalanceTarget(driver);
    setBalanceAmount('');
    setBalanceReason('');
    openBalance();
  }

  function submitBalance() {
    if (!balanceTarget || balanceAmount === '' || balanceAmount <= 0) return;
    balanceMutation.mutate({
      id: balanceTarget.id,
      amount: Number(balanceAmount),
      reason: balanceReason.trim() || undefined,
    });
  }

  return (
    <div>
      <Group justify="space-between" mb="md" wrap="wrap">
        <Title order={3}>Sürücüler</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={openCreateForm}>
          Yeni sürücü
        </Button>
      </Group>

      <Text size="xs" c="dimmed" mb="xs">
        Performans sıralaması için Puan, Yolculuk veya Kabul % başlığına tıklayın.
      </Text>

      <Table.ScrollContainer minWidth={900}>
        <Table verticalSpacing="sm" striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Ad</Table.Th>
              <Table.Th visibleFrom="sm">Telefon</Table.Th>
              <Table.Th>Plaka</Table.Th>
              <Table.Th visibleFrom="md">Araç</Table.Th>
              <SortableTh field="rating">Puan</SortableTh>
              <SortableTh field="total_rides">Yolculuk</SortableTh>
              <SortableTh field="acceptance_rate">Kabul %</SortableTh>
              <Table.Th>Bakiye</Table.Th>
              <Table.Th visibleFrom="sm">Durum</Table.Th>
              <Table.Th>Erişim</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {sortedDrivers.map((driver) => (
              <Table.Tr key={driver.id}>
                <Table.Td>
                  <Text fw={500}>{driver.users?.full_name ?? '—'}</Text>
                  <Text size="xs" c="dimmed" hiddenFrom="sm">
                    {driver.users?.phone ?? '—'}
                  </Text>
                </Table.Td>
                <Table.Td visibleFrom="sm">{driver.users?.phone ?? '—'}</Table.Td>
                <Table.Td>{driver.vehicle_plate}</Table.Td>
                <Table.Td visibleFrom="md">
                  {driver.vehicle_model} {driver.vehicle_color}
                </Table.Td>
                <Table.Td>{driver.users?.rating_count ? driverRating(driver).toFixed(1) : '—'}</Table.Td>
                <Table.Td>{driver.total_rides}</Table.Td>
                <Table.Td>{Math.round((driver.acceptance_rate ?? 0) * 100)}%</Table.Td>
                <Table.Td>
                  <Group gap={4} wrap="nowrap">
                    <Text>{driver.balance.toFixed(2)} T</Text>
                    <Tooltip label="Bakiye ekle">
                      <ActionIcon size="sm" variant="light" onClick={() => openBalanceDialog(driver)}>
                        <IconPlus size={14} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Cüzdan hareketleri">
                      <ActionIcon
                        size="sm"
                        variant="light"
                        color="gray"
                        onClick={() => navigate(`/wallet?driverId=${driver.id}`)}
                      >
                        <IconWallet size={14} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Table.Td>
                <Table.Td visibleFrom="sm">
                  <Badge color={driver.is_online ? 'green' : 'gray'} variant="light">
                    {driver.is_online ? 'Çevrimiçi' : 'Çevrimdışı'}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Switch
                    checked={driver.is_available}
                    onChange={(e) =>
                      accessMutation.mutate({ id: driver.id, enabled: e.currentTarget.checked })
                    }
                  />
                </Table.Td>
                <Table.Td>
                  <Group gap={4} wrap="nowrap">
                    <Tooltip label="Düzenle">
                      <ActionIcon variant="light" onClick={() => openEditForm(driver)}>
                        <IconEdit size={16} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Sil">
                      <ActionIcon
                        variant="light"
                        color="red"
                        onClick={() => {
                          if (confirm('Bu sürücüyü silmek istediğinize emin misiniz?')) {
                            deleteMutation.mutate(driver.id);
                          }
                        }}
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
            {!isLoading && (drivers ?? []).length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={11}>
                  <Text c="dimmed" ta="center">
                    Kayıtlı sürücü yok.
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

      <Modal opened={formOpened} onClose={closeForm} title={editing ? 'Sürücüyü düzenle' : 'Yeni sürücü'}>
        <form onSubmit={form.onSubmit(handleSubmit)}>
          <Stack gap="sm">
            <TextInput label="Ad Soyad" required {...form.getInputProps('full_name')} />
            <TextInput label="Telefon" required placeholder="+905551112233" {...form.getInputProps('phone')} />
            <PasswordInput
              label={editing ? 'Yeni şifre (opsiyonel)' : 'Şifre'}
              required={!editing}
              {...form.getInputProps('password')}
            />
            <TextInput label="Plaka" required {...form.getInputProps('vehicle_plate')} />
            <TextInput label="Araç modeli" required {...form.getInputProps('vehicle_model')} />
            <TextInput label="Araç rengi" required {...form.getInputProps('vehicle_color')} />
            <Button type="submit" loading={createMutation.isPending || updateMutation.isPending} mt="sm">
              Kaydet
            </Button>
          </Stack>
        </form>
      </Modal>

      <Modal opened={balanceOpened} onClose={closeBalance} title={`Bakiye ekle — ${balanceTarget?.users?.full_name ?? ''}`}>
        <Stack gap="sm">
          <Group gap="xs">
            {[50, 100, 200, 500].map((amount) => (
              <Button key={amount} size="xs" variant="light" onClick={() => setBalanceAmount(amount)}>
                +{amount}
              </Button>
            ))}
          </Group>
          <NumberInput
            label="Tutar (T Coin)"
            min={1}
            value={balanceAmount}
            onChange={(v) => setBalanceAmount(typeof v === 'number' ? v : '')}
          />
          <TextInput
            label="Not (opsiyonel)"
            placeholder="Örn. destek talebi #123 için manuel iade"
            value={balanceReason}
            onChange={(e) => setBalanceReason(e.currentTarget.value)}
          />
          <Button onClick={submitBalance} loading={balanceMutation.isPending}>
            Ekle
          </Button>
        </Stack>
      </Modal>
    </div>
  );
}
