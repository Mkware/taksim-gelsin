import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Avatar, Button, Card, Center, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconAlertCircle } from '@tabler/icons-react';
import { useAuth } from './AuthContext';
import { getErrorMessage } from '../api/client';

interface FormValues {
  phone: string;
  password: string;
}

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    initialValues: { phone: '', password: '' },
    validate: {
      phone: (value) => (value.trim().length < 10 ? 'Geçerli bir telefon numarası girin.' : null),
      password: (value) => (value.length < 1 ? 'Şifre gerekli.' : null),
    },
  });

  async function handleSubmit(values: FormValues) {
    setSubmitting(true);
    setError(null);
    try {
      await login(values.phone.trim(), values.password);
      navigate('/overview', { replace: true });
    } catch (err) {
      setError(getErrorMessage(err, 'Giriş başarısız.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Center
      mih="100vh"
      p="md"
      style={{
        background:
          'linear-gradient(160deg, var(--mantine-color-brandAmber-1) 0%, var(--mantine-color-body) 45%)',
      }}
    >
      <Card withBorder shadow="lg" radius="lg" p="xl" w={400}>
        <Stack gap="lg">
          <Stack align="center" gap={6}>
            <Avatar color="brandAmber" radius="md" size={56} styles={{ root: { fontSize: 22, fontWeight: 700 } }}>
              TG
            </Avatar>
            <Title order={2} ta="center">
              Taksim Gelsin
            </Title>
            <Text c="dimmed" size="sm" ta="center">
              Yönetim paneline giriş yapın
            </Text>
          </Stack>

          {error && (
            <Alert color="red" variant="light" icon={<IconAlertCircle size={18} />}>
              {error}
            </Alert>
          )}

          <form onSubmit={form.onSubmit(handleSubmit)}>
            <Stack gap="sm">
              <TextInput
                label="Telefon"
                placeholder="+90 555 123 45 67"
                autoComplete="tel"
                size="md"
                {...form.getInputProps('phone')}
              />
              <PasswordInput
                label="Şifre"
                placeholder="••••••••"
                autoComplete="current-password"
                size="md"
                {...form.getInputProps('password')}
              />
              <Button type="submit" loading={submitting} fullWidth size="md" mt="sm">
                Giriş yap
              </Button>
            </Stack>
          </form>
        </Stack>
      </Card>
    </Center>
  );
}
