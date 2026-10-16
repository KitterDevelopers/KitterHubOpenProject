/**
 * 投稿页（重做版）。
 *
 * 版面思路：**按填写顺序一条直线填到底，右边常驻「预览 + 清单 + 提交」**。
 *   ┌ ① 选择作品来源 ─ 从编程猫导入 / 手动填编号 / 内嵌网址
 *   ├ ② 作品信息      ─ 标题 / 简介 / 标签
 *   ├ ③ 作品性质      ─ 原创声明 / 转载原作
 *   ├ ④ 分类与封面
 *   └ ⑤ 发布方式      ─ 立即 / 审核 / 定时
 *
 * 与改动前的区别（站长要求「投稿页面前端完全重构」）：
 *   1. 编程猫导入**不再弹窗**，直接内嵌在「选择作品来源」下面，进页面就能看到作品卡片。
 *   2. 点一个作品会去拉编程猫**作品详情**，用官方给的 player_url 反推编辑器 ——
 *      这是必须的，因为列表里的 type 分不出 Kitten3/Kitten4，以前是靠「当前选中的编辑器」猜的，经常填错。
 *   3. **已投稿的作品会被置灰并写明原因**（已投稿 / 审核中 / 上次未通过可重投），不再能重复投稿。
 *   4. 右栏只留「预览 / 清单 / 提交」，「分类与封面」回到主栏跟其它字段排一起。
 *   5. 原来的「折叠选项」按钮去掉了 —— 那是版面本身有问题的症状。
 */
import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Rocket } from 'lucide-react';
import MsIcon from '../../components/MsIcon';
import { useI18n } from '../../i18n';
import { useAuth } from '../../context/AuthContext';
import useWorkForm from './useWorkForm';
import useCodemaoImport from './useCodemaoImport';
import CodemaoImport from './CodemaoImport';
import { SourceFields, InfoFields, NatureFields, SettingsFields, PublishFields } from './Fields';
import Rail from './Rail';
import { SOURCE_CODEMAO, SOURCE_MANUAL } from './constants';

export default function WorkCreate() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const { user } = useAuth();
  const f = useWorkForm();

  /**
   * 从 Kitten4 发布助手（浏览器扩展）带过来的参数：
   *   /works/new?editor=kitten4&editor_work_id=331489864&title=…&description=…&category=…
   * 只在这个页面**首次挂载**时应用一次，之后用户自己的修改不会被覆盖。
   * 没有这些参数时行为与以前完全一致。
   */
  const [searchParams] = useSearchParams();
  const appliedFromExt = useRef(false);
  useEffect(() => {
    if (appliedFromExt.current) return;
    const editor = searchParams.get('editor');
    const workId = searchParams.get('editor_work_id');
    const title = searchParams.get('title');
    const desc = searchParams.get('description');
    const cat = searchParams.get('category');
    if (!editor && !workId && !title) return;
    appliedFromExt.current = true;
    try {
      if (typeof f.setSource === 'function' && editor) f.setSource(SOURCE_MANUAL);   // 「手动填写编号」这条路 = 编辑器 + 编号
      if (editor && f.setEditorCode) f.setEditorCode(editor);
      if (workId && f.setEditorWorkId) f.setEditorWorkId(workId);
      if (title && f.setTitle) f.setTitle(title);
      if (desc && f.setDescription) f.setDescription(desc);
      if (cat && f.setCategory) f.setCategory(cat);
      if (typeof f.setOrigin === 'function') f.setOrigin('codemao_repost');
    } catch (e) {
      // 参数不合法也只是不预填，不影响正常投稿
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const hasCodemao = Boolean(user?.codemao_uid);
  const cm = useCodemaoImport({
    enabled: f.source === SOURCE_CODEMAO,
    hasCodemao,
    applyImport: f.applyCodemaoImport,
  });

  return (
    <div className="page-pad wf-page">
      <header className="wf-head">
        <div style={{ minWidth: 0 }}>
          <h1 className="row" style={{ margin: 0, fontWeight: 800, gap: 8, alignItems: 'center', fontSize: 24 }}>
            <MsIcon name="rocket_launch" size={22} /> {t('creator.publishWork')}
          </h1>
          <p className="muted" style={{ margin: '6px 0 0' }}>{t('form.workIntro')}</p>
        </div>
      </header>

      {f.error && (
        <div className="m3-badge m3-badge--error wf-error">
          <MsIcon name="error" size={16} />
          <span>{f.error}</span>
        </div>
      )}

      <div className="wf-grid">
        <div className="wf-main">
          <SourceFields
            source={f.source}
            setSource={f.setSource}
            hasCodemao={hasCodemao}
            codemaoSlot={(
              <CodemaoImport
                bound={hasCodemao}
                uid={user?.codemao_uid}
                works={cm.works}
                meta={cm.meta}
                loading={cm.loading}
                error={cm.error}
                pickingId={cm.pickingId}
                selectedId={cm.selectedId}
                onReload={cm.load}
                onPick={cm.pick}
                imported={f.imported}
              />
            )}
            editors={f.editors}
            editorCode={f.editorCode}
            setEditorCode={f.setEditorCode}
            editorWorkId={f.editorWorkId}
            setEditorWorkId={f.setEditorWorkId}
            activeEditor={f.activeEditor}
            playUrl={f.playUrl}
            sourceUrl={f.sourceUrl}
            setSourceUrl={f.setSourceUrl}
            urlOk={f.urlOk}
            sb3={f.sb3}
            sb3Busy={f.sb3Busy}
            uploadSb3={f.uploadSb3}
          />

          <InfoFields
            title={f.title}
            setTitle={f.setTitle}
            description={f.description}
            setDescription={f.setDescription}
            tagArr={f.tagArr}
            tagInput={f.tagInput}
            setTagInput={f.setTagInput}
            onTagKey={f.onTagKey}
            removeTag={f.removeTag}
            addTag={f.addTag}
          />

          <NatureFields
            attr={f.attr}
            setAttr={f.setAttr}
            isOriginal={f.isOriginal}
            setIsOriginal={f.setIsOriginal}
            originalUrl={f.originalUrl}
            setOriginalUrl={f.setOriginalUrl}
            origOk={f.origOk}
            activeEditor={f.activeEditor}
            editorWorkId={f.editorWorkId}
            fillOriginalFromEditor={f.fillOriginalFromEditor}
          />

          <SettingsFields
            category={f.category}
            setCategory={f.setCategory}
            coverUrl={f.coverUrl}
            setCoverUrl={f.setCoverUrl}
            isScratch={f.workType === 'scratch'}
            coverMode={f.coverMode}
            setCoverMode={f.setCoverMode}
            coverBusy={f.coverBusy}
            autoCover={f.autoCover}
          />

          <PublishFields
            forceReview={f.forceReview}
            publishMode={f.publishMode}
            setPublishMode={f.setPublishMode}
            scheduledAt={f.scheduledAt}
            setScheduledAt={f.setScheduledAt}
          />

          {/* 窄屏时右栏会落到下面，这里给一个回到创作中心的出口 */}
          <div className="row" style={{ justifyContent: 'center', marginTop: 4 }}>
            <button type="button" className="wf-inline-action" onClick={() => navigate('/create')}>
              <Rocket size={15} /> {t('topbar.createCenter')}
            </button>
          </div>
        </div>

        <Rail f={f} />
      </div>
    </div>
  );
}
