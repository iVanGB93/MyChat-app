import {t} from '../../localization/language';
import React from 'react';
import {View} from 'react-native';
import EmptyState from '../../components/ui/EmptyState';
import {useTheme} from '../../contexts/ThemeContext';
export default function Game(){const {colors}=useTheme();return <View style={{flex:1,backgroundColor:colors.background}}><EmptyState iconName="game-controller-outline" title={t("Coming soon")}/></View>;}
