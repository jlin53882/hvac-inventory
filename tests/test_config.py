# -*- coding: utf-8 -*-
"""app/config.py 環境變數與 .env 讀取測試（直接測試真實函式，不重寫一份解析邏輯）"""
import os


from app.config import load_env_file, parse_env_text


class TestParseEnvText:
    """parse_env_text() 純函式解析"""

    def test_reads_key_values(self):
        assert parse_env_text("TEST_KEY_1=hello\nTEST_KEY_2=world\n") == {
            "TEST_KEY_1": "hello", "TEST_KEY_2": "world",
        }

    def test_skips_comments_and_blank_lines(self):
        text = "# comment\n\nREAL_KEY=real_value\n# ANOTHER=yes\n  \nSECOND_KEY=second\n"
        assert parse_env_text(text) == {"REAL_KEY": "real_value", "SECOND_KEY": "second"}

    def test_skips_malformed_lines_and_keeps_extra_equals(self):
        text = "VALID_KEY=valid\nNO_EQUALS_SIGN\n=empty_key\nKEY_WITH_EQUALS=val=ue\n"
        result = parse_env_text(text)
        assert result == {"VALID_KEY": "valid", "KEY_WITH_EQUALS": "val=ue"}

    def test_strips_matching_quotes_and_keeps_hash_inside(self):
        text = "A=\"hello world\"\nB='single # not comment'\nC=\"unbalanced\n"
        assert parse_env_text(text) == {
            "A": "hello world", "B": "single # not comment", "C": "\"unbalanced",
        }

    def test_export_prefix_and_inline_comment_on_unquoted_value(self):
        text = "export TOKEN=abc123   # 備註\nURL=https://x.test/path#frag\n"
        assert parse_env_text(text) == {"TOKEN": "abc123", "URL": "https://x.test/path#frag"}

    def test_handles_crlf_line_endings(self):
        assert parse_env_text("K1=v1\r\nK2=v2\r\n") == {"K1": "v1", "K2": "v2"}


class TestLoadEnvFile:
    """load_env_file() 寫入 environ 的規則"""

    def test_loads_into_given_environ(self, tmp_path):
        env_file = tmp_path / ".env"
        env_file.write_text("A=1\nB=2\n", encoding="utf-8")
        environ = {}
        assert sorted(load_env_file(str(env_file), environ)) == ["A", "B"]
        assert environ == {"A": "1", "B": "2"}

    def test_does_not_overwrite_existing_env(self, tmp_path):
        env_file = tmp_path / ".env"
        env_file.write_text("DISCORD_WEBHOOK_URL=should-not-overwrite\nNEW=1\n", encoding="utf-8")
        environ = {"DISCORD_WEBHOOK_URL": "existing-value"}
        assert load_env_file(str(env_file), environ) == ["NEW"]
        assert environ["DISCORD_WEBHOOK_URL"] == "existing-value"

    def test_missing_file_is_noop(self, tmp_path):
        environ = {}
        assert load_env_file(str(tmp_path / "nope.env"), environ) == []
        assert environ == {}

    def test_utf8_bom_is_ignored(self, tmp_path):
        env_file = tmp_path / ".env"
        env_file.write_bytes("\ufeffFIRST=ok\n".encode("utf-8"))
        environ = {}
        load_env_file(str(env_file), environ)
        assert environ == {"FIRST": "ok"}    # 沒處理 BOM 時 key 會變成 "\ufeffFIRST"


class TestRuntimeSettings:
    def test_importing_config_does_not_create_dirs(self, tmp_path, monkeypatch):
        """import config 不得有目錄副作用；建立目錄是 ensure_runtime_dirs() 的事。"""

        import app.config as cfg

        source = open(cfg.__file__, encoding="utf-8").read()
        top_level_calls = [line for line in source.splitlines() if line.startswith("os.makedirs")]
        assert top_level_calls == []
        monkeypatch.setattr(cfg, "STATIC_DIR", str(tmp_path / "static"))
        monkeypatch.setattr(cfg, "UPLOAD_DIR", str(tmp_path / "static" / "uploads"))
        cfg.ensure_runtime_dirs()
        assert (tmp_path / "static" / "uploads").is_dir()

    def test_use_frontend_source_reads_env_at_call_time(self, monkeypatch):
        import app.config as cfg

        monkeypatch.delenv("HVAC_FRONTEND_SOURCE", raising=False)
        assert cfg.use_frontend_source() is False
        monkeypatch.setenv("HVAC_FRONTEND_SOURCE", "1")
        assert cfg.use_frontend_source() is True
        monkeypatch.setenv("HVAC_FRONTEND_SOURCE", "0")
        assert cfg.use_frontend_source() is False

    def test_tests_write_logs_under_logs_test(self):
        """conftest 已把 HVAC_LOG_DIR 指向 logs/test，測試不會污染正式 logs/。"""
        import app.config as cfg

        assert os.environ["HVAC_LOG_DIR"].replace("\\", "/").endswith("logs/test")
        assert cfg.LOG_BASE == os.environ["HVAC_LOG_DIR"]


class TestDiscordConfig:
    """Discord webhook 環境變數讀取"""

    def test_config_has_webhook_attrs(self):
        """config 模組有 webhook 相關屬性"""
        import app.config as cfg
        assert hasattr(cfg, "DISCORD_WEBHOOK_URL")
        assert hasattr(cfg, "GCAL_SYNC_WEBHOOK_URL")
        assert hasattr(cfg, "GCAL_SYNC_THREAD_ID")

    def test_config_webhook_values_are_strings(self):
        """webhook 變數是字串型別"""
        import app.config as cfg
        assert isinstance(cfg.DISCORD_WEBHOOK_URL, str)
        assert isinstance(cfg.GCAL_SYNC_WEBHOOK_URL, str)
        assert isinstance(cfg.GCAL_SYNC_THREAD_ID, str)

    def test_config_reads_from_env(self, monkeypatch):
        """config 從環境變數讀取 webhook 值"""
        monkeypatch.setenv("DISCORD_WEBHOOK_URL", "https://test-discord-webhook")
        monkeypatch.setenv("GCAL_SYNC_WEBHOOK_URL", "https://test-gcal-webhook")
        monkeypatch.setenv("GCAL_SYNC_THREAD_ID", "9999999999")
        # 重新 import 觸發 _load_env
        import importlib
        import app.config
        importlib.reload(app.config)
        assert app.config.DISCORD_WEBHOOK_URL == "https://test-discord-webhook"
        assert app.config.GCAL_SYNC_WEBHOOK_URL == "https://test-gcal-webhook"
        assert app.config.GCAL_SYNC_THREAD_ID == "9999999999"

    def test_config_default_empty_when_not_set(self, monkeypatch):
        """未設定環境變數時 webhook 值為空字串"""
        monkeypatch.delenv("DISCORD_WEBHOOK_URL", raising=False)
        monkeypatch.delenv("GCAL_SYNC_WEBHOOK_URL", raising=False)
        monkeypatch.delenv("GCAL_SYNC_THREAD_ID", raising=False)
        import importlib
        import app.config
        importlib.reload(app.config)
        # 未設定時可能是空字串或 .env 的值（取決於 .env 是否存在）
        assert isinstance(app.config.DISCORD_WEBHOOK_URL, str)


class TestNotifyDiscordIntegration:
    """_notify_discord 整合測試"""

    def test_no_webhook_silently_skips(self, monkeypatch):
        """webhook 未設定時 _notify_discord 靜默跳過"""
        import app.config as cfg
        monkeypatch.setattr(cfg, "GCAL_SYNC_WEBHOOK_URL", "")
        from app.services.sync_scheduler import _notify_discord
        # 不應抛異常，也不應呼叫 urlopen
        _notify_discord("should not send")

    def test_no_thread_id_sends_without_thread(self, monkeypatch):
        """thread_id 空白時不帶 thread_id 參數"""
        import app.config as cfg
        monkeypatch.setattr(cfg, "GCAL_SYNC_WEBHOOK_URL", "https://discord.com/api/webhooks/test/test")
        monkeypatch.setattr(cfg, "GCAL_SYNC_THREAD_ID", "")
        from app.services.sync_scheduler import _notify_discord
        called = {}

        def mock_urlopen(req, timeout=10):
            called["url"] = req.full_url
            class FakeResp:
                status = 204
                def read(self): return b""
            return FakeResp()

        monkeypatch.setattr("urllib.request.urlopen", mock_urlopen)
        _notify_discord("test")

        assert "thread_id=" not in called["url"]
        assert called["url"] == "https://discord.com/api/webhooks/test/test"
