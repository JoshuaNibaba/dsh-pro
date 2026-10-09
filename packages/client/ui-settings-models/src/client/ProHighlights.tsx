/** DeepSeek Harness Pro highlight pages shown by the first-run welcome notice. */

import type { ReactNode } from 'react'
import {
  IconCheckCircleFillRegular, IconDownloadOutlineRegular, IconFolderOpenRegular,
  IconGaugeOutlineRegular, IconGlobeOutlineRegular, IconPanelLeftOutlineRegular,
  IconChecklistOutlineRegular, IconSearchOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { en } from './locales.ts'
import css from './ProHighlights.module.css'

type T = (key: keyof typeof en) => string

/** One welcome page: its heading, body, and illustration. */
export interface ProHighlight {
  /** Stable page id, also the illustration's test hook. */
  id: 'overview' | 'kanban' | 'remote' | 'status' | 'speed'
  /** Locale key of the page heading. */
  headingKey: keyof typeof en
  /** Locale key of the page body. */
  bodyKey: keyof typeof en
  /** Decorative illustration; hidden from assistive technology. */
  Illustration: (props: { t: T }) => ReactNode
}

function Overview({ t }: { t: T }): ReactNode {
  const tiles: ReadonlyArray<[keyof typeof en, ReactNode]> = [
    ['welcomeOverviewKanban', <IconChecklistOutlineRegular key="kanban" />],
    ['welcomeOverviewRemote', <IconGlobeOutlineRegular key="remote" />],
    ['welcomeOverviewStatus', <IconGaugeOutlineRegular key="status" />],
    ['welcomeOverviewPhone', <IconPanelLeftOutlineRegular key="phone" />],
    ['welcomeOverviewFiles', <IconDownloadOutlineRegular key="files" />],
    ['welcomeOverviewSearch', <IconSearchOutlineRegular key="search" />],
  ]
  return (
    <div className={css.tiles}>
      {tiles.map(([key, icon]) => (
        <div key={key} className={css.tile}>
          <span className={css.tileIcon}>{icon}</span>
          <span>{t(key)}</span>
        </div>
      ))}
    </div>
  )
}

function Kanban({ t }: { t: T }): ReactNode {
  return (
    <div className={css.board}>
      {(['welcomeKanbanPlan', 'welcomeKanbanLane', 'welcomeKanbanDone'] as const).map(key => (
        <div key={key} className={css.column}>
          <span className={css.columnTitle}>{t(key)}</span>
        </div>
      ))}
      <div className={`${css.card} ${css.planA}`}>{t('welcomeKanbanTaskPlanA')}</div>
      <div className={`${css.card} ${css.planB}`}>{t('welcomeKanbanTaskPlanB')}</div>
      <div className={`${css.card} ${css.cardDone} ${css.doneA}`}>{t('welcomeKanbanTaskDone')}</div>
      <div className={`${css.card} ${css.moving}`}>{t('welcomeKanbanTaskMoving')}</div>
      <span className={css.pointer} />
    </div>
  )
}

function Remote({ t }: { t: T }): ReactNode {
  return (
    <div className={css.remote}>
      <div className={css.device}>
        <span className={css.laptop} />
        <span>{t('welcomeRemoteMac')}</span>
      </div>
      <span className={css.link} />
      <div className={css.device}>
        <span className={css.server}><i /><i /><i /></span>
        <span>{t('welcomeRemoteServer')}</span>
      </div>
      <span className={`${css.link} ${css.linkReverse}`} />
      <div className={css.device}>
        <span className={css.phone}><i /></span>
        <span>{t('welcomeRemotePhone')}</span>
      </div>
    </div>
  )
}

function Status({ t }: { t: T }): ReactNode {
  return (
    <div className={css.status}>
      <div className={css.tree}>
        <div className={css.treeRow}><IconFolderOpenRegular />{t('welcomeStatusFolder')}</div>
        <div className={`${css.treeRow} ${css.treeChild} ${css.treeHover}`}>
          <span>{t('welcomeStatusFileA')}</span>
          <span className={css.download}><IconDownloadOutlineRegular /></span>
        </div>
        <div className={`${css.treeRow} ${css.treeChild}`}>{t('welcomeStatusFileB')}</div>
      </div>
      <div className={css.footer}>
        <span className={css.connected}><span className={css.dot} />{t('welcomeStatusConnected')}</span>
        <span className={css.cpu}>{t('welcomeStatusCpu')}<span className={css.meter}><span /></span></span>
        <span>{t('welcomeStatusMemory')}</span>
        <span>{t('welcomeStatusLatency')}</span>
      </div>
    </div>
  )
}

function Speed({ t }: { t: T }): ReactNode {
  const items = ['welcomeSpeedSearch', 'welcomeSpeedCompression', 'welcomeSpeedHistory', 'welcomeSpeedCache'] as const
  return (
    <ul className={css.checks}>
      {items.map(key => (
        <li key={key}><span className={css.check}><IconCheckCircleFillRegular /></span>{t(key)}</li>
      ))}
    </ul>
  )
}

/** The welcome pages in display order. */
export const PRO_HIGHLIGHTS: readonly ProHighlight[] = [
  { id: 'overview', headingKey: 'welcomeOverviewHeading', bodyKey: 'welcomeOverviewBody', Illustration: Overview },
  { id: 'kanban', headingKey: 'welcomeKanbanHeading', bodyKey: 'welcomeKanbanBody', Illustration: Kanban },
  { id: 'remote', headingKey: 'welcomeRemoteHeading', bodyKey: 'welcomeRemoteBody', Illustration: Remote },
  { id: 'status', headingKey: 'welcomeStatusHeading', bodyKey: 'welcomeStatusBody', Illustration: Status },
  { id: 'speed', headingKey: 'welcomeSpeedHeading', bodyKey: 'welcomeSpeedBody', Illustration: Speed },
]
