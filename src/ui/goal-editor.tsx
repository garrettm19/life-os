import { useState } from 'react';
import { Text } from 'react-native';
import { Goal } from '../domain/model';
import { updateGoal } from '../domain/goals';
import { useApp } from '../state/app-state';
import { Button, Field, Sheet, styles } from './components';

export function GoalEditor({ goal, close }: { goal: Goal; close: () => void }) {
  const { change } = useApp();
  const [title, setTitle] = useState(goal.title);
  const [criteria, setCriteria] = useState(goal.desiredState);
  return (
    <Sheet title="Edit goal" visible close={close}>
      <Text style={styles.muted}>
        Describe your own target and how you will recognize success. Leave criteria blank while
        deciding. Your linked programs and recorded actions stay connected.
      </Text>
      <Field label="Goal title" value={title} onChange={setTitle} />
      <Field label="Success criteria" value={criteria} onChange={setCriteria} multiline />
      <Button
        title="Save goal changes"
        disabled={!title.trim()}
        needs="Give the goal a title to save it."
        onPress={() =>
          void change((state) => updateGoal(state, goal.id, title, criteria)).then((saved) => {
            if (saved) close();
          })
        }
      />
    </Sheet>
  );
}
