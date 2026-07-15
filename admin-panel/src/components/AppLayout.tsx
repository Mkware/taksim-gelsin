import {
  ActionIcon,
  AppShell,
  Avatar,
  Burger,
  Container,
  Divider,
  Group,
  Menu,
  NavLink,
  ScrollArea,
  Stack,
  Text,
  Title,
  useMantineColorScheme,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconActivity,
  IconCar,
  IconChevronDown,
  IconClipboardList,
  IconDashboard,
  IconFileText,
  IconLogout,
  IconMoonStars,
  IconRoute,
  IconSettings,
  IconStar,
  IconSun,
  IconUsers,
  IconWallet,
} from '@tabler/icons-react';
import { NavLink as RouterNavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

const NAV_GROUPS = [
  {
    label: 'Genel',
    items: [
      { to: '/overview', label: 'Genel Bakış', icon: IconDashboard },
      { to: '/live-ops', label: 'Canlı Operasyon', icon: IconActivity },
    ],
  },
  {
    label: 'Yönetim',
    items: [
      { to: '/drivers', label: 'Sürücüler', icon: IconCar },
      { to: '/customers', label: 'Müşteriler', icon: IconUsers },
      { to: '/rides', label: 'Yolculuklar', icon: IconRoute },
      { to: '/reviews', label: 'Değerlendirmeler', icon: IconStar },
    ],
  },
  {
    label: 'Finans & Denetim',
    items: [
      { to: '/wallet', label: 'Cüzdan Hareketleri', icon: IconWallet },
      { to: '/audit-log', label: 'Denetim Kaydı', icon: IconClipboardList },
    ],
  },
  {
    label: 'Sistem',
    items: [
      { to: '/logs', label: 'Loglar', icon: IconFileText },
      { to: '/settings', label: 'Ayarlar', icon: IconSettings },
    ],
  },
];

function ColorSchemeToggle() {
  const { colorScheme, toggleColorScheme } = useMantineColorScheme();
  return (
    <ActionIcon variant="subtle" color="gray" onClick={() => toggleColorScheme()} size="lg">
      {colorScheme === 'dark' ? <IconSun size={18} /> : <IconMoonStars size={18} />}
    </ActionIcon>
  );
}

export function AppLayout() {
  const [opened, { toggle }] = useDisclosure();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{ width: 250, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <Group gap={8}>
              <Avatar color="brandAmber" radius="md" size={32}>
                TG
              </Avatar>
              <Title order={4} visibleFrom="xs">
                Taksim Gelsin
              </Title>
            </Group>
          </Group>

          <Group gap="xs" wrap="nowrap">
            <ColorSchemeToggle />
            <Menu shadow="md" width={200} position="bottom-end">
              <Menu.Target>
                <Group gap={6} style={{ cursor: 'pointer' }} wrap="nowrap">
                  <Avatar color="gray" radius="xl" size={30} />
                  <Text size="sm" fw={500} visibleFrom="xs">
                    {user?.phone}
                  </Text>
                  <IconChevronDown size={14} />
                </Group>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>{user?.full_name || user?.phone}</Menu.Label>
                <Menu.Divider />
                <Menu.Item color="red" leftSection={<IconLogout size={16} />} onClick={handleLogout}>
                  Çıkış yap
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="sm">
        <ScrollArea>
          <Stack gap="lg">
            {NAV_GROUPS.map((group) => (
              <div key={group.label}>
                <Text size="xs" fw={700} c="dimmed" tt="uppercase" px="sm" mb={4}>
                  {group.label}
                </Text>
                <Stack gap={2}>
                  {group.items.map((item) => (
                    <NavLink
                      key={item.to}
                      component={RouterNavLink}
                      to={item.to}
                      label={item.label}
                      leftSection={<item.icon size={18} stroke={1.75} />}
                      active={location.pathname.startsWith(item.to)}
                      variant="filled"
                      style={{ borderRadius: 'var(--mantine-radius-md)' }}
                    />
                  ))}
                </Stack>
              </div>
            ))}
          </Stack>
        </ScrollArea>
      </AppShell.Navbar>

      <AppShell.Main bg="var(--mantine-color-body)">
        <Divider hiddenFrom="sm" mb="md" />
        <Container size="xl" px={0}>
          <Outlet />
        </Container>
      </AppShell.Main>
    </AppShell>
  );
}
