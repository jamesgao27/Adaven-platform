/**
 * Permission scope–style lit/unlit chips for classification dimensions (firm engagements & client marketplace).
 * Pass `dimensions` to hide rows (e.g. marketplace omits tax season).
 */
import { View, Text, TouchableOpacity } from 'react-native';
import {
  CLASSIFICATION_DIMENSIONS,
  CLASSIFICATION_DIMENSION_LABEL,
  type ClassificationDimension,
  type ClassificationDimFilter,
  getClassificationChipColors,
  SCOPE_ALL_LIT_BG,
  SCOPE_ALL_LIT_FG,
  SCOPE_CHIP_MUTED_FG,
  SCOPE_CHIP_UNLIT_BG,
} from '@/lib/firm-classification-dimensions';

export type EngagementClassificationChipStyles = {
  dimGroupsWrap: object;
  dimBlock: object;
  dimTitleRow: object;
  dimTitle: object;
  dimEmpty: object;
  scopeChipsWrap: object;
  metaTag: object;
  scopeLabelChip: object;
  scopeLabelChipMin: object;
  scopeLabelChipText: object;
};

export default function EngagementClassificationFilterChips(props: {
  optionsByDim: Record<ClassificationDimension, string[]>;
  classFilterByDim: Record<ClassificationDimension, ClassificationDimFilter>;
  onToggleValue: (d: ClassificationDimension, value: string) => void;
  onSelectAll: (d: ClassificationDimension) => void;
  chipStyles: EngagementClassificationChipStyles;
  /** Defaults to all dimensions (firm engagements). */
  dimensions?: readonly ClassificationDimension[];
}) {
  const {
    optionsByDim,
    classFilterByDim,
    onToggleValue,
    onSelectAll,
    chipStyles: s,
    dimensions = CLASSIFICATION_DIMENSIONS,
  } = props;
  return (
    <View style={s.dimGroupsWrap}>
      {dimensions.map((d) => {
        const labels = optionsByDim[d];
        const f = classFilterByDim[d];
        const allLit = f.mode === 'all';
        return (
          <View key={d} style={s.dimBlock}>
            <View style={s.dimTitleRow}>
              <Text style={s.dimTitle}>{CLASSIFICATION_DIMENSION_LABEL[d]}</Text>
            </View>
            {labels.length === 0 ? (
              <Text style={s.dimEmpty}>No values in current list</Text>
            ) : (
              <View style={s.scopeChipsWrap}>
                <TouchableOpacity onPress={() => onSelectAll(d)} activeOpacity={0.85}>
                  <View
                    style={[
                      s.metaTag,
                      s.scopeLabelChip,
                      s.scopeLabelChipMin,
                      { backgroundColor: allLit ? SCOPE_ALL_LIT_BG : SCOPE_CHIP_UNLIT_BG },
                    ]}
                  >
                    <Text
                      style={[
                        s.scopeLabelChipText,
                        {
                          color: allLit ? SCOPE_ALL_LIT_FG : SCOPE_CHIP_MUTED_FG,
                          fontWeight: allLit ? '700' : '500',
                        },
                      ]}
                      numberOfLines={1}
                    >
                      ALL
                    </Text>
                  </View>
                </TouchableOpacity>
                {labels.map((lab) => {
                  const lit = f.mode === 'include' && f.values.has(lab);
                  const [bg, fg] = getClassificationChipColors(lab);
                  return (
                    <TouchableOpacity key={`${d}-${lab}`} onPress={() => onToggleValue(d, lab)} activeOpacity={0.85}>
                      <View
                        style={[s.metaTag, s.scopeLabelChip, s.scopeLabelChipMin, { backgroundColor: lit ? bg : SCOPE_CHIP_UNLIT_BG }]}
                      >
                        <Text
                          style={[
                            s.scopeLabelChipText,
                            {
                              color: lit ? fg : SCOPE_CHIP_MUTED_FG,
                              fontWeight: lit ? '600' : '500',
                            },
                          ]}
                          numberOfLines={1}
                        >
                          {lab}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}
