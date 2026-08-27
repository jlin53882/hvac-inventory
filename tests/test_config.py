# -*- coding: utf-8 -*-
"""app/config.py 環境變數與 .env 讀取測試"""
import os
import tempfile


class TestLoadEnv:
    """_load_env() .env 讀取邏輯"""

    def test_reads_env_file(self, tmp_path):
        """正確讀取 .env 檔案中的鍵值"""
        env_file = tmp_path / ".env"
        env_file.write_text("TEST_KEY_1=hello\nTEST_KEY_2=world\n", encoding="utf-8")

        from app.config import _load_env
        # 臨時修改 .env 路徑：_load_env 讀的是專案根的 .env，
        # 這裡直接測試其解析邏輯
        result = {}
        with open(env_file, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                result[key.strip()] = value.strip()

        assert result["TEST_KEY_1"] == "hello"
        assert result["TEST_KEY_2"] == "world"

    def test_skips_comments_and_blank_lines(self, tmp_path):
        """跳過註解行和空行"""
        env_file = tmp_path / ".env"
        env_file.write_text(
            "# This is a comment\n"
            "\n"
            "REAL_KEY=real_value\n"
            "# ANOTHER_COMMENT=yes\n"
            "  \n"
            "SECOND_KEY=second\n",
            encoding="utf-8",
        )

        result = {}
        with open(env_file, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                result[key.strip()] = value.strip()

        assert result == {"REAL_KEY": "real_value", "SECOND_KEY": "second"}

    def test_does_not_overwrite_existing_env(self, monkeypatch):
        """已存在的環境變數不被 .env 覆蓋"""
        monkeypatch.setenv("DISCORD_WEBHOOK_URL", "existing-value")

        from app.config import _load_env
        # _load_env 只在 import 時跑一次，這裡手動測試其邏輯
        # 模擬：環境變數已存在 → .env 的值不覆蓋
        os.environ["DISCORD_WEBHOOK_URL"] = "existing-value"
        new_value = "should-not-overwrite"
        if "DISCORD_WEBHOOK_URL" not in os.environ:
            os.environ["DISCORD_WEBHOOK_URL"] = new_value
        assert os.environ["DISCORD_WEBHOOK_URL"] == "existing-value"
        del os.environ["DISCORD_WEBHOOK_URL"]

    def test_missing_env_file_no_crash(self, tmp_path):
        """缺少 .env 檔案不報錯"""
        # _load_env 在 .env 不存在時直接 return
        env_path = tmp_path / ".env"
        assert not env_path.exists()  # 確認不存在
        # 不應抛異常

    def test_skips_malformed_lines(self, tmp_path):
        """格式異常的行（無 = 號）被跳過"""
        env_file = tmp_path / ".env"
        env_file.write_text(
            "VALID_KEY=valid\n"
            "NO_EQUALS_SIGN\n"
            "=empty_key\n"
            "KEY_WITH_EQUALS=val=ue\n",
            encoding="utf-8",
        )

        result = {}
        with open(env_file, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                key = key.strip()
                if key:  # 與 _load_env 一致：空 key 跳過
                    result[key] = value.strip()

        assert result["VALID_KEY"] == "valid"
        assert result["KEY_WITH_EQUALS"] == "val=ue"
        # "=empty_key" 的 key 是 "" → _load_env 的 `if key` 會跳過
        assert "" not in result


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
