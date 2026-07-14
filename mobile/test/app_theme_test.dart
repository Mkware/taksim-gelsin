import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:taksim_gelsin/core/theme/app_theme.dart';

void main() {
  testWidgets('AppTheme.lightTheme geçerli bir ThemeData üretir', (
    WidgetTester tester,
  ) async {
    final ThemeData theme = AppTheme.lightTheme;

    expect(theme.useMaterial3, isTrue);
    expect(theme.colorScheme.primary, AppTheme.primaryColor);
  });
}
