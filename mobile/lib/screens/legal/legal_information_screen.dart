import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../content/legal_texts_tr.dart';
import '../../core/theme/app_theme.dart';

/// KVKK, gizlilik politikası ve kullanım koşulları — App Store / Play ve KVKK için erişilebilir okuma.
class LegalInformationScreen extends StatefulWidget {
  const LegalInformationScreen({super.key, this.initialTab = 0});

  /// 0: KVKK aydınlatma, 1: Gizlilik, 2: Kullanım koşulları
  final int initialTab;

  @override
  State<LegalInformationScreen> createState() => _LegalInformationScreenState();
}

class _LegalInformationScreenState extends State<LegalInformationScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabController;
  late final List<ScrollController> _scrollControllers;

  static const _tabs = <({String short, String long})>[
    (short: 'KVKK', long: 'Aydınlatma'),
    (short: 'Gizlilik', long: 'Gizlilik politikası'),
    (short: 'Koşullar', long: 'Kullanım koşulları'),
  ];

  static const _bodies = <String>[
    LegalTextsTr.kvkkClarification,
    LegalTextsTr.privacyPolicy,
    LegalTextsTr.termsOfUse,
  ];

  @override
  void initState() {
    super.initState();
    final idx = widget.initialTab.clamp(0, _tabs.length - 1);
    _tabController = TabController(
      length: _tabs.length,
      vsync: this,
      initialIndex: idx,
    );
    _scrollControllers = List.generate(_tabs.length, (_) => ScrollController());
  }

  @override
  void dispose() {
    _tabController.dispose();
    for (final c in _scrollControllers) {
      c.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final padding = MediaQuery.paddingOf(context);
    final textScaler = MediaQuery.textScalerOf(context);

    return Semantics(
      label: 'Yasal metinler ve gizlilik',
      child: Scaffold(
        backgroundColor: AppTheme.backgroundColor,
        appBar: AppBar(
          backgroundColor: AppTheme.backgroundColor,
          foregroundColor: AppTheme.ink,
          elevation: 0,
          scrolledUnderElevation: 0,
          systemOverlayStyle: SystemUiOverlayStyle.dark,
          title: Text(
            'Yasal ve gizlilik',
            style: GoogleFonts.inter(fontWeight: FontWeight.w800, fontSize: 18),
          ),
          bottom: PreferredSize(
            preferredSize: const Size.fromHeight(48),
            child: Material(
              color: AppTheme.backgroundColor,
              child: TabBar(
                controller: _tabController,
                isScrollable: true,
                tabAlignment: TabAlignment.start,
                labelColor: AppTheme.primaryColor,
                unselectedLabelColor: AppTheme.textSecondary,
                indicatorColor: AppTheme.primaryColor,
                indicatorWeight: 3,
                labelStyle: GoogleFonts.inter(fontWeight: FontWeight.w700, fontSize: 13),
                unselectedLabelStyle: GoogleFonts.inter(fontWeight: FontWeight.w600, fontSize: 13),
                tabs: [
                  for (final t in _tabs)
                    Tab(
                      height: 44,
                      child: Semantics(
                        label: t.long,
                        button: true,
                        child: Text(t.short),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ),
        body: TabBarView(
          controller: _tabController,
          children: [
            for (var i = 0; i < _bodies.length; i++)
              Scrollbar(
                controller: _scrollControllers[i],
                thumbVisibility: true,
                child: SingleChildScrollView(
                  controller: _scrollControllers[i],
                  padding: EdgeInsets.fromLTRB(20, 8, 20, 24 + padding.bottom),
                  child: SelectableText(
                    '${_bodies[i]}${LegalTextsTr.disclaimerFooter}\n\n${LegalTextsTr.lastUpdatedTr}',
                    style: GoogleFonts.inter(
                      fontSize: 15,
                      height: 1.55,
                      color: AppTheme.textPrimary,
                      fontWeight: FontWeight.w400,
                    ),
                    textScaler: textScaler,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
