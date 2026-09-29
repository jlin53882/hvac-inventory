// 庫存管理系統 - 行事曆 Google 同步狀態標籤與重試判斷

export function calSyncStatusLabel(status) {
  return status === 'synced' ? '已同步至你的 Google 日曆'
    : status === 'partial_failed' ? '部分同步失敗'
    : status === 'partial_retrying' ? '部分同步重試中'
    : status === 'retrying' ? '同步重試中'
    : status === 'pending' ? '等待同步'
    : status === 'failed' ? '同步失敗'
    : status === 'not_assigned' ? ''
    : status === 'not_bound' ? '未綁定同步 Key'
    : status === 'paused' ? '同步 Key 已停用'
    : status === 'not_targeted' ? '尚未同步至你的日曆'
    : '未綁定同步 Key';
}

export function calSyncStatusIcon(status) {
  return status === 'synced' ? '✅'
    : status === 'partial_failed' ? '⚠️'
    : status === 'partial_retrying' ? '🔄'
    : status === 'retrying' ? '🔄'
    : status === 'pending' ? '⏳'
    : status === 'failed' ? '❌'
    : status === 'paused' ? '⏸️' : '';
}

export function calPersonalSync(e) {
  return e.my_sync_status || {
    status: e.sync_status || 'none',
    key_name: e.sync_error_key || '',
    cal_id: e.sync_error_cal || '',
    error: e.sync_error || '',
    attempts: e.sync_error_attempts || 0,
  };
}

function calCanRetrySyncStatus(status) {
  return ['pending', 'retrying', 'partial_retrying', 'failed', 'partial_failed'].includes(status);
}

export function calCanRetryPersonal(personal) {
  return Boolean(personal && personal.can_retry === true);
}

export function calCanRetryTeamPerson(person) {
  return Boolean(person && person.can_retry === true);
}

function calHasTeamSyncInfo(team) {
  if (!team) return false;
  return (team.eligible_people || 0)
    + (team.unbound_people || 0)
    + (team.paused_people || 0)
    + (team.inactive_people || 0)
    + (team.fallback_target_count || 0) > 0;
}

export function calTeamHasRetryableTarget(team) {
  return Boolean(team && team.can_retry_all === true);
}

export function calTeamSyncLabel(team) {
  if (!team) return '';
  if (team.fallback_target_count && !team.eligible_people) {
    return `同步至全部有效 Google 行事曆（${team.fallback_target_count} 個）${team.can_retry_all ? ' ⏳' : ''}`;
  }
  if (!team.eligible_people && !team.fallback_target_count) {
    return '目前沒有可用的 Google 行事曆，請先新增或啟用 Calendar Key';
  }
  if (!calHasTeamSyncInfo(team)) return '';
  const icon = team.failed_people ? ' ⚠️' : team.pending_people || team.retrying_people ? ' ⏳' : '';
  return `團隊：${team.synced_people}/${team.eligible_people} 同步${icon}`;
}
