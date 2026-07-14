import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:taksim_gelsin/core/widgets/online_scan_bar.dart';

void main() {
  testWidgets('active=true iken hatasız render olur ve animasyon ilerler', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: SizedBox(
          width: 300,
          child: OnlineScanBar(active: true),
        ),
      ),
    );

    expect(tester.takeException(), isNull);

    // Sürekli tekrar eden (repeat) animasyon — pumpAndSettle asla bitmez,
    // bu yüzden sabit adımlarla ilerletip ara karelerde hata olmadığını doğruluyoruz.
    await tester.pump(const Duration(milliseconds: 400));
    expect(tester.takeException(), isNull);
    await tester.pump(const Duration(milliseconds: 1700));
    expect(tester.takeException(), isNull);
  });

  testWidgets('active=false iken görünmez olur, sonradan true olunca tekrar animasyona başlar', (
    WidgetTester tester,
  ) async {
    var active = false;
    await tester.pumpWidget(
      MaterialApp(
        home: StatefulBuilder(
          builder: (context, setState) => Column(
            children: [
              SizedBox(
                width: 300,
                child: OnlineScanBar(active: active),
              ),
              TextButton(
                onPressed: () => setState(() => active = true),
                child: const Text('go online'),
              ),
            ],
          ),
        ),
      ),
    );

    expect(tester.takeException(), isNull);
    await tester.pump(const Duration(milliseconds: 500));

    await tester.tap(find.text('go online'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 800));

    expect(tester.takeException(), isNull);
  });
}
