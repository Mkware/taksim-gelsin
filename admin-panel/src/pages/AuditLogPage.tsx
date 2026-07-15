import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Code, Group, Pagination, Table, Text, TextInput, Title } from '@mantine/core';
import dayjs from 'dayjs';
import { getAuditLog } from '../api/admin';

export function AuditLogPage() {
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'audit-log', action, page],
    queryFn: () => getAuditLog({ action: action.trim() || undefined, page, limit: 50 }),
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <div>
      <Title order={3} mb="md">
        Denetim Kaydı
      </Title>

      <Group mb="md">
        <TextInput
          placeholder="Eylem ile filtrele (örn. driver.balance_add)"
          value={action}
          onChange={(e) => {
            setAction(e.currentTarget.value);
            setPage(1);
          }}
          w={320}
        />
      </Group>

      <Table.ScrollContainer minWidth={900}>
        <Table verticalSpacing="sm" striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Tarih</Table.Th>
              <Table.Th>Admin</Table.Th>
              <Table.Th>Eylem</Table.Th>
              <Table.Th>Hedef</Table.Th>
              <Table.Th>Detay</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(data?.items ?? []).map((entry) => (
              <Table.Tr key={entry.id}>
                <Table.Td>
                  <Text size="sm">{dayjs(entry.created_at).format('DD.MM.YYYY HH:mm')}</Text>
                </Table.Td>
                <Table.Td>{entry.admin_phone}</Table.Td>
                <Table.Td>
                  <Code>{entry.action}</Code>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">
                    {entry.target_type ?? '—'}
                    {entry.target_id ? ` #${entry.target_id.slice(0, 8)}` : ''}
                  </Text>
                </Table.Td>
                <Table.Td>
                  {entry.details ? (
                    <Text size="xs" c="dimmed" style={{ maxWidth: 320, whiteSpace: 'pre-wrap' }}>
                      {JSON.stringify(entry.details)}
                    </Text>
                  ) : (
                    '—'
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
            {!isLoading && (data?.items ?? []).length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={5}>
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
