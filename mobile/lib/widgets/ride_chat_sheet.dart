import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import '../core/theme/app_theme.dart';
import '../providers/providers.dart';

/// Aktif yolculuk sohbeti — kalıcılık yok, mesajlar sunucuda yalnızca yolculuk
/// süresince Redis'te tutulur. Hem müşteri hem sürücü ekranından açılır.
class RideChatSheet extends ConsumerStatefulWidget {
  final String rideId;
  final String peerName;

  const RideChatSheet({super.key, required this.rideId, required this.peerName});

  @override
  ConsumerState<RideChatSheet> createState() => _RideChatSheetState();
}

/// Sürücü ve müşteri için hızlı gönderim önerileri — dokunulunca doğrudan gönderilir.
const _kDriverQuickReplies = <String>[
  'Yoldayım',
  '5 dakikaya oradayım',
  'Geldim, sizi bekliyorum',
  'Trafik var, birazcık gecikebilirim',
];

const _kCustomerQuickReplies = <String>[
  'Geliyorum',
  'Birazdan aşağıdayım',
  'Neredesiniz?',
  'Lütfen biraz bekleyin',
];

class _RideChatSheetState extends ConsumerState<RideChatSheet> {
  final _messages = <Map<String, dynamic>>[];
  final _seenIds = <String>{};
  final _textController = TextEditingController();
  final _scrollController = ScrollController();
  final _subs = <StreamSubscription<void>>[];
  bool _loadingHistory = true;

  @override
  void initState() {
    super.initState();
    final socket = ref.read(socketServiceProvider);

    _subs.add(socket.onMessageHistory.listen((data) {
      if (!mounted || data['rideId'] != widget.rideId) return;
      final list = (data['messages'] as List?) ?? const [];
      setState(() {
        _loadingHistory = false;
        for (final m in list) {
          _addMessage(Map<String, dynamic>.from(m as Map));
        }
      });
      _scrollToBottomSoon();
    }));

    _subs.add(socket.onNewMessage.listen((data) {
      if (!mounted || data['rideId'] != widget.rideId) return;
      setState(() => _addMessage(data));
      _scrollToBottomSoon();
    }));

    // Soğuk başlangıçta (bildirimden açılış) socket henüz bağlanmamış olabilir —
    // bağlantı kurulunca geçmişi yeniden iste; mesajlar id ile dedupe ediliyor.
    _subs.add(socket.onConnected.listen((_) {
      if (mounted) socket.getMessageHistory(widget.rideId);
    }));

    socket.getMessageHistory(widget.rideId);
    Future<void>.delayed(const Duration(seconds: 5), () {
      if (mounted && _loadingHistory) setState(() => _loadingHistory = false);
    });
  }

  void _addMessage(Map<String, dynamic> message) {
    final id = message['id']?.toString();
    if (id != null && !_seenIds.add(id)) return;
    _messages.add(message);
  }

  void _scrollToBottomSoon() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scrollController.hasClients) return;
      _scrollController.animateTo(
        _scrollController.position.maxScrollExtent,
        duration: const Duration(milliseconds: 250),
        curve: Curves.easeOut,
      );
    });
  }

  void _send([String? presetText]) {
    final text = (presetText ?? _textController.text).trim();
    if (text.isEmpty) return;
    ref.read(socketServiceProvider).sendMessage(widget.rideId, text);
    if (presetText == null) _textController.clear();
  }

  @override
  void dispose() {
    for (final s in _subs) {
      s.cancel();
    }
    _textController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final myId = ref.watch(currentUserProvider)?.id;
    final myRole = ref.watch(currentUserProvider)?.role;
    final bottomInset = MediaQuery.viewInsetsOf(context).bottom;

    return Padding(
      padding: EdgeInsets.only(bottom: bottomInset),
      child: Container(
        height: MediaQuery.sizeOf(context).height * 0.75,
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(AppTheme.radiusLg)),
        ),
        child: SafeArea(
          top: false,
          child: Column(
            children: [
              const SizedBox(height: 8),
              Container(
                width: 42,
                height: 4,
                decoration: BoxDecoration(
                  color: const Color(0xFFBFC4CC),
                  borderRadius: BorderRadius.circular(999),
                ),
              ),
              _header(),
              const Divider(height: 1, color: AppTheme.dividerColor),
              Expanded(child: _body(myId)),
              _quickReplies(myRole),
              _composer(),
            ],
          ),
        ),
      ),
    );
  }

  Widget _header() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
      child: Row(
        children: [
          const Icon(LucideIcons.messageCircle, color: AppTheme.primaryColor, size: 20),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              widget.peerName,
              style: GoogleFonts.inter(fontSize: 15, fontWeight: FontWeight.w800),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          IconButton(
            onPressed: () => Navigator.of(context).pop(),
            icon: const Icon(LucideIcons.x),
          ),
        ],
      ),
    );
  }

  Widget _body(String? myId) {
    if (_loadingHistory && _messages.isEmpty) {
      return const Center(child: CircularProgressIndicator(strokeWidth: 2.2));
    }
    if (_messages.isEmpty) {
      return Center(
        child: Text(
          'Henüz mesaj yok. Yolculukla ilgili not gönderebilirsiniz.',
          textAlign: TextAlign.center,
          style: GoogleFonts.inter(fontSize: 13, color: AppTheme.textMuted, fontWeight: FontWeight.w600),
        ),
      );
    }
    return ListView.builder(
      controller: _scrollController,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      itemCount: _messages.length,
      itemBuilder: (context, index) {
        final m = _messages[index];
        final isMe = m['senderId'] == myId;
        return _bubble(text: m['text']?.toString() ?? '', isMe: isMe);
      },
    );
  }

  Widget _bubble({required String text, required bool isMe}) {
    return Align(
      alignment: isMe ? Alignment.centerRight : Alignment.centerLeft,
      child: GestureDetector(
        onLongPress: () => _copyMessage(text),
        child: Container(
          margin: const EdgeInsets.symmetric(vertical: 4),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.72),
          decoration: BoxDecoration(
            color: isMe ? AppTheme.primaryColor : AppTheme.subtle,
            borderRadius: BorderRadius.only(
              topLeft: const Radius.circular(16),
              topRight: const Radius.circular(16),
              bottomLeft: Radius.circular(isMe ? 16 : 4),
              bottomRight: Radius.circular(isMe ? 4 : 16),
            ),
          ),
          child: Text(
            text,
            style: GoogleFonts.inter(
              fontSize: 13.5,
              fontWeight: FontWeight.w600,
              color: isMe ? AppTheme.ink : AppTheme.textPrimary,
            ),
          ),
        ),
      ),
    );
  }

  void _copyMessage(String text) {
    HapticFeedback.selectionClick();
    Clipboard.setData(ClipboardData(text: text));
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Mesaj kopyalandı'), duration: Duration(seconds: 1)),
    );
  }

  Widget _quickReplies(String? myRole) {
    final replies = myRole == 'driver' ? _kDriverQuickReplies : _kCustomerQuickReplies;
    return Container(
      height: 48,
      padding: const EdgeInsets.symmetric(vertical: 6),
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: AppTheme.dividerColor)),
      ),
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 12),
        itemCount: replies.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (context, index) {
          final text = replies[index];
          return ActionChip(
            label: Text(
              text,
              style: GoogleFonts.inter(fontSize: 12.5, fontWeight: FontWeight.w600),
            ),
            onPressed: () => _send(text),
            backgroundColor: AppTheme.subtle,
            side: BorderSide.none,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
            visualDensity: VisualDensity.compact,
            materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
          );
        },
      ),
    );
  }

  Widget _composer() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
      child: Row(
        children: [
          Expanded(
            child: TextField(
              controller: _textController,
              minLines: 1,
              maxLines: 4,
              maxLength: 1000,
              textInputAction: TextInputAction.send,
              onSubmitted: (_) => _send(),
              buildCounter: (_, {required currentLength, required isFocused, maxLength}) => null,
              decoration: InputDecoration(
                hintText: 'Mesaj yaz...',
                filled: true,
                fillColor: AppTheme.subtle,
                isDense: true,
                contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(AppTheme.radiusSm),
                  borderSide: BorderSide.none,
                ),
              ),
            ),
          ),
          const SizedBox(width: 8),
          IconButton.filled(
            onPressed: _send,
            icon: const Icon(LucideIcons.send, size: 20),
            style: IconButton.styleFrom(
              backgroundColor: AppTheme.primaryColor,
              foregroundColor: AppTheme.ink,
            ),
          ),
        ],
      ),
    );
  }
}

/// Sohbet panelini modal bottom sheet olarak açar.
/// Açıkken gelen mesajlar okunmamış sayılmaz; kapanınca rozet sıfırlanır.
///
/// Sheet zaten açıksa hiçbir şey yapmaz — aksi halde (örn. bildirime arka arkaya
/// tıklanması, `onMessageOpenedApp`'in aynı mesaj için birden fazla tetiklenmesi gibi
/// durumlarda) üst üste modal ve yinelenen socket dinleyicileri birikip özellikle
/// düşük belleğe sahip cihazlarda kasma/OOM crash'e yol açıyordu.
Future<void> showRideChatSheet(
  BuildContext context, {
  required WidgetRef ref,
  required String rideId,
  required String peerName,
}) {
  if (ref.read(rideChatSheetOpenProvider)) return Future<void>.value();
  ref.read(rideChatSheetOpenProvider.notifier).state = true;
  ref.read(chatUnreadCountProvider.notifier).clear();
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (_) => RideChatSheet(rideId: rideId, peerName: peerName),
  ).whenComplete(() {
    ref.read(rideChatSheetOpenProvider.notifier).state = false;
    ref.read(chatUnreadCountProvider.notifier).clear();
  });
}
