import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Fullscreen sticky immersion — game draws edge to edge.
  await SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
  runApp(const TagalogVsBisayaApp());
}

class TagalogVsBisayaApp extends StatelessWidget {
  const TagalogVsBisayaApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Tagalog vs Bisaya',
      debugShowCheckedModeBanner: false,
      theme: ThemeData.dark(useMaterial3: true),
      home: const GameScreen(),
    );
  }
}

/// Tiny localhost server that serves the bundled PWA (assets/www) over HTTP
/// so relative paths for JS/CSS/PNG/MP3 all resolve with zero plugins.
class _LocalServer {
  HttpServer? _server;

  int get port => _server?.port ?? 0;

  static const _mime = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.jpg': 'image/jpeg',
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
    '.wav': 'audio/wav',
    '.txt': 'text/plain; charset=utf-8',
    '.md': 'text/plain; charset=utf-8',
  };

  Future<void> start() async {
    _server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    _server!.listen(_handle);
  }

  Future<void> _handle(HttpRequest req) async {
    try {
      var path = req.uri.path;
      if (path == '/' || path.isEmpty) path = '/index.html';
      // Strip query, block traversal.
      path = path.split('?').first;
      if (path.contains('..')) {
        req.response
          ..statusCode = HttpStatus.forbidden
          ..close();
        return;
      }
      final key = 'assets/www$path';
      final data = await rootBundle.load(key);
      final ext = '.${path.split('.').last.toLowerCase()}';
      req.response.headers.contentType =
          ContentType.parse(_mime[ext] ?? 'application/octet-stream');
      req.response.headers.set('Cache-Control', 'no-cache');
      req.response.add(data.buffer.asUint8List());
      await req.response.close();
    } catch (_) {
      try {
        req.response
          ..statusCode = HttpStatus.notFound
          ..write('not found')
          ..close();
      } catch (_) {}
    }
  }

  Future<void> close() async => _server?.close(force: true);
}

class GameScreen extends StatefulWidget {
  const GameScreen({super.key});

  @override
  State<GameScreen> createState() => _GameScreenState();
}

class _GameScreenState extends State<GameScreen> {
  final _server = _LocalServer();
  WebViewController? _controller;

  @override
  void initState() {
    super.initState();
    _boot();
  }

  Future<void> _boot() async {
    await _server.start();
    final controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0xFF0C0D14))
      ..loadRequest(Uri.parse('http://127.0.0.1:${_server.port}/index.html'));
    if (controller.platform is AndroidWebViewController) {
      final android = controller.platform as AndroidWebViewController;
      await android.setMediaPlaybackRequiresUserGesture(false);
    }
    if (mounted) setState(() => _controller = controller);
  }

  @override
  void dispose() {
    _server.close();
    super.dispose();
  }

  Future<bool> _onBack() async {
    final c = _controller;
    if (c != null && await c.canGoBack()) {
      await c.goBack();
      return false; // handled inside the game webview
    }
    return true; // exit app
  }

  @override
  Widget build(BuildContext context) {
    final controller = _controller;
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        if (await _onBack() && context.mounted) {
          Navigator.of(context).maybePop();
        }
      },
      child: Scaffold(
        backgroundColor: const Color(0xFF0C0D14),
        body: SafeArea(
          top: false,
          bottom: false,
          child: controller == null
              ? const Center(child: CircularProgressIndicator())
              : WebViewWidget(controller: controller),
        ),
      ),
    );
  }
}
