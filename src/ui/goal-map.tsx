import { useState } from 'react';
import { Text, View } from 'react-native';
import { State } from '../domain/model';
import { useApp } from '../state/app-state';
import { Sheet } from './components';
import { Row } from './list';
import { fonts, type } from './theme';

/**
 * Each goal with the programs that serve it, read from the links already made. A goal with no
 * program says so plainly: it is a direction, noted in the life log and reviews, not an
 * objective. Nothing is inferred; links are changed by editing a program.
 */
function goalMap(state: State) {
  return state.goals.map((goal) => {
    const programs = state.programs.filter((p) => p.goalIds.includes(goal.id));
    const notes = state.lifeLog.filter((e) => e.goalId === goal.id).length;
    return { goal, programs, notes };
  });
}

/** The row in Programs' plan group that opens the goals with the programs serving each. */
export function GoalMap() {
  const { state } = useApp();
  const [open, setOpen] = useState(false);
  if (!state.goals.length) return null;
  return (
    <>
      <Row
        icon="target"
        tone="sun"
        title="Life goals"
        detail="The programs that serve each one"
        value={String(state.goals.length)}
        label={`Life goals, ${state.goals.length}`}
        onPress={() => setOpen(true)}
      />
      <Sheet title="Life goals" visible={open} close={() => setOpen(false)}>
        <View testID="goal-map" style={{ gap: 14 }}>
          {goalMap(state).map(({ goal, programs, notes }) => (
            <View key={goal.id} accessible style={{ gap: 1 }}>
              <Text style={{ ...type.item, ...fonts.semibold }}>{goal.title}</Text>
              <Text style={type.caption}>
                {programs.length
                  ? programs.map((p) => p.title).join(' · ')
                  : `No scheduled objective${notes ? ` · ${notes} life-log note${notes === 1 ? '' : 's'}` : ''}`}
              </Text>
            </View>
          ))}
          <Text style={type.footnote}>
            Link a program to a goal by editing the program. Edit goals in Settings.
          </Text>
        </View>
      </Sheet>
    </>
  );
}
