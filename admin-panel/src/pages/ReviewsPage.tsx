import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge, Card, Group, SegmentedControl, Stack, Text, Title } from '@mantine/core';
import dayjs from 'dayjs';
import { getReviews } from '../api/admin';

type RatingFilter = 'all' | 1 | 2 | 3 | 4 | 5;

export function ReviewsPage() {
  const [rating, setRating] = useState<RatingFilter>('all');

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'reviews', rating],
    queryFn: () => getReviews({ rating, limit: 50 }),
  });

  const counts = data?.counts;
  const total = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0;

  return (
    <div>
      <Title order={3} mb="md">
        Değerlendirmeler
      </Title>

      <SegmentedControl
        mb="md"
        value={String(rating)}
        onChange={(v) => setRating(v === 'all' ? 'all' : (Number(v) as RatingFilter))}
        data={[
          { label: `Tümü (${total})`, value: 'all' },
          ...[5, 4, 3, 2, 1].map((r) => ({
            label: `${r}★ (${counts?.[r as 1 | 2 | 3 | 4 | 5] ?? 0})`,
            value: String(r),
          })),
        ]}
      />

      <Stack gap="sm">
        {(data?.items ?? []).map((review) => (
          <Card key={review.id} withBorder radius="md" padding="md">
            <Group justify="space-between" mb={4}>
              <Group gap={6}>
                <Badge color={review.rating <= 2 ? 'red' : 'yellow'} variant="light">
                  {review.rating}★
                </Badge>
                <Text size="sm">
                  {review.reviewer.full_name} ({review.reviewer.role === 'driver' ? 'Sürücü' : 'Yolcu'}) →{' '}
                  {review.reviewed.full_name} ({review.reviewed.role === 'driver' ? 'Sürücü' : 'Yolcu'})
                </Text>
              </Group>
              <Text size="xs" c="dimmed">
                {dayjs(review.created_at).format('DD.MM.YYYY HH:mm')}
              </Text>
            </Group>
            {review.ride && (
              <Text size="xs" c="dimmed" mb={4}>
                {review.ride.pickup_address} → {review.ride.dropoff_address}
              </Text>
            )}
            {review.comment && <Text size="sm">{review.comment}</Text>}
          </Card>
        ))}
        {!isLoading && (data?.items ?? []).length === 0 && (
          <Text c="dimmed" ta="center">
            Sonuç bulunamadı.
          </Text>
        )}
      </Stack>
    </div>
  );
}
