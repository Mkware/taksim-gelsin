import { useQuery } from '@tanstack/react-query';
import { Alert, Group, NumberInput, Paper, ScrollArea, SimpleGrid, Text, Title } from '@mantine/core';
import { useEffect, useRef, useState } from 'react';
import { getLogs } from '../api/admin';

// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_REGEX = /\x1b\[[0-9;]*m/g;

type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'other';

const LEVEL_COLORS: Record<LogLevel, string> = {
  error: 'red',
  warn: 'orange',
  info: 'blue',
  debug: 'gray',
  other: 'dimmed',
};

function detectLevel(line: string): LogLevel {
  const match = /\]\s*(ERROR|WARN|INFO|DEBUG)\s*:/i.exec(line);
  if (!match) return 'other';
  return match[1].toLowerCase() as LogLevel;
}

function cleanLine(line: string): string {
  return line.replace(ANSI_ESCAPE_REGEX, '');
}

function LogPanel({ title, lines }: { title: string; lines: string[] }) {
  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTo({ top: viewport.scrollHeight });
  }, [lines]);

  return (
    <Paper withBorder p="sm" radius="md">
      <Text fw={600} mb="xs">
        {title}
      </Text>
      <ScrollArea h={480} viewportRef={viewportRef}>
        <div style={{ fontFamily: 'monospace', fontSize: 'var(--mantine-font-size-xs)' }}>
          {lines.length > 0 ? (
            lines.map((rawLine, idx) => {
              const line = cleanLine(rawLine);
              const level = detectLevel(line);
              return (
                <Text
                  key={idx}
                  c={LEVEL_COLORS[level]}
                  ff="monospace"
                  fz="xs"
                  style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
                >
                  {line}
                </Text>
              );
            })
          ) : (
            <Text c="dimmed" fz="xs">
              (kayıt yok)
            </Text>
          )}
        </div>
      </ScrollArea>
    </Paper>
  );
}

export function LogsPage() {
  const [lines, setLines] = useState<number>(200);

  const { data, isFetching } = useQuery({
    queryKey: ['admin', 'logs', lines],
    queryFn: () => getLogs(lines),
    refetchInterval: 15_000,
  });

  return (
    <div>
      <Group justify="space-between" mb="md">
        <Title order={3}>Sunucu Logları</Title>
        <Group gap="xs" align="center">
          <Text size="sm" c="dimmed">
            {isFetching ? 'Yenileniyor…' : 'Her 15 saniyede otomatik yenilenir'}
          </Text>
          <NumberInput
            value={lines}
            onChange={(v) => setLines(typeof v === 'number' ? v : 200)}
            min={20}
            max={1000}
            step={50}
            w={110}
          />
        </Group>
      </Group>

      {data && !data.configured && (
        <Alert color="yellow" mb="md">
          {data.message}
        </Alert>
      )}

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
        <LogPanel title="stdout" lines={data?.out ?? []} />
        <LogPanel title="stderr" lines={data?.error ?? []} />
      </SimpleGrid>
    </div>
  );
}
