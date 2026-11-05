import { useState } from 'react';
import { activeFocus, focusDay } from '../domain/focus';
import { localDate } from '../domain/model';
import { useApp } from '../state/app-state';
import { FocusEditor } from './focus-editor';
import { Row } from './list';

/**
 * One row of Programs' plan group: the active 90-day focus, or a quiet way to choose one. Opens the
 * editor.
 */
export function FocusRow() {
  const { state } = useApp();
  const [open, setOpen] = useState(false);
  const focus = activeFocus(state);
  const status = focus ? focusDay(focus, localDate()) : null;
  return (
    <>
      <Row
        icon="scope"
        tone={focus ? 'accent' : 'slate'}
        title={focus ? focus.title : 'Choose a 90-day focus'}
        detail={
          status
            ? status.due
              ? '90-day focus · review due'
              : `90-day focus · day ${status.day} of ${status.of}`
            : 'Optional: one priority for the next 90 days'
        }
        label={
          focus ? `90-day focus: ${focus.title}. Edit focus` : 'Choose a 90-day focus (optional)'
        }
        onPress={() => setOpen(true)}
      />
      {open && <FocusEditor visible close={() => setOpen(false)} />}
    </>
  );
}
