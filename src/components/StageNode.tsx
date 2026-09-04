import { useEffect, useRef, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { StageNode as StageNodeType } from '../types';
import { Icon } from './Icon';

const KIND_LABELS = { start: '开始', process: '阶段', decision: '判断', end: '结束' } as const;
export const RENAME_STAGE_EVENT = 'flowsketch:rename-stage';

const PORTS = [
  { id: 'left', position: Position.Left, className: 'left', style: undefined },
  { id: 'right', position: Position.Right, className: 'right', style: undefined },
  { id: 'top-left', position: Position.Top, className: 'top-left', style: { left: '34%' } },
  { id: 'top-right', position: Position.Top, className: 'top-right', style: { left: '66%' } },
  { id: 'bottom-left', position: Position.Bottom, className: 'bottom-left', style: { left: '34%' } },
  { id: 'bottom-right', position: Position.Bottom, className: 'bottom-right', style: { left: '66%' } }
] as const;

export function StageNode({ id, data, selected }: NodeProps<StageNodeType>) {
  const hasNotes = Boolean(data.notes.trim());
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(data.title);
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setTitleDraft(data.title), [data.title]);
  useEffect(() => {
    if (editingTitle) titleInputRef.current?.select();
  }, [editingTitle]);

  const finishTitleEdit = () => {
    const title = titleDraft.trim();
    setEditingTitle(false);
    if (!title || title === data.title) {
      setTitleDraft(data.title);
      return;
    }
    window.dispatchEvent(new CustomEvent(RENAME_STAGE_EVENT, { detail: { nodeId: id, title } }));
  };

  const handleClass = (type: 'source' | 'target', position: string) => (
    `stage-handle stage-handle--${type} stage-handle--${position}`
  );

  return (
    <div className={`stage-node stage-node--${data.kind}${selected ? ' is-selected' : ''}`} aria-label={`${KIND_LABELS[data.kind]}：${data.title}`}>
      {PORTS.flatMap((port) => ([
        <Handle
          key={`source-${port.id}`}
          id={`source-${port.id}`}
          type="source"
          position={port.position}
          className={handleClass('source', port.className)}
          style={port.style}
          title="从此点连接"
          aria-hidden="true"
        />,
        <Handle
          key={`target-${port.id}`}
          id={`target-${port.id}`}
          type="target"
          position={port.position}
          className={handleClass('target', port.className)}
          style={port.style}
          title="连接到此点"
          aria-hidden="true"
        />
      ]))}
      <div className="stage-node__kind"><Icon name={data.kind} size={14} />{KIND_LABELS[data.kind]}</div>
      {editingTitle ? (
        <input
          ref={titleInputRef}
          className="stage-node__title-input nodrag nowheel"
          value={titleDraft}
          maxLength={160}
          aria-label="阶段名称"
          onChange={(event) => setTitleDraft(event.target.value)}
          onBlur={finishTitleEdit}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') {
              setTitleDraft(data.title);
              setEditingTitle(false);
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="stage-node__title nodrag"
          title="点击修改标题"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            setEditingTitle(true);
          }}
        >
          {data.title}
        </button>
      )}
      <div className={`stage-node__note${hasNotes ? ' has-note' : ''}`} aria-label={hasNotes ? '已有备注' : '暂无备注'}>
        <Icon name="note" size={13} />{hasNotes ? '已有备注' : '添加备注'}
      </div>
    </div>
  );
}
