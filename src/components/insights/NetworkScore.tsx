import { Contact } from '@/types';
import { calculateNetworkScore } from '@/utils/networkAnalytics';
import { getNetworkMetricsExplanation } from '@/utils/metricExplanations';
import Tooltip from '@/components/Tooltip';
import { Icon, IconName } from '@/components/ui';

/** The one thing the score points at right now, with a way to do it. */
export interface NextStep {
  text: string;
  label?: string;
  onClick?: () => void;
}

interface Props {
  contacts: Contact[];
  className?: string;
  priorityEmails?: Set<string>;
  goingColdCount?: number;
  onViewChange?: (view: 'organize' | 'analyze') => void;
  nextStep?: NextStep;
}

export default function NetworkScore({ contacts, priorityEmails, goingColdCount, onViewChange, nextStep }: Props) {
  const baseMetrics = calculateNetworkScore(contacts, priorityEmails);
  const metrics = getNetworkMetricsExplanation(baseMetrics.metrics);
  
  return (
    <div className="bg-white rounded-2xl p-8 shadow-sm">
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-8">
        {/* Score Section */}
        <div className="flex items-center gap-8">
          <div>
            <div className="flex items-center gap-3">
              <div className="text-6xl font-bold text-[#1E1E3F]">
                {baseMetrics.score}
              </div>
              <div className={`h-12 w-1.5 rounded-full ${
                baseMetrics.score >= 80 ? 'bg-[#22C55E]' : 
                baseMetrics.score >= 50 ? 'bg-[#EAB308]' : 
                'bg-red-500'
              }`} />
            </div>
            <div className="text-sm font-medium text-gray-500 mt-1">Network Score</div>
            <p className="text-sm text-gray-600 mt-2 max-w-xs">
              {baseMetrics.score >= 80 ? 'Excellent network health! Keep up the great work.' :
               baseMetrics.score >= 50 ? 'Good foundation. Room for strengthening connections.' :
               'Let\'s work on building stronger relationships.'}
            </p>
            {baseMetrics.metrics.priorityCount > 0 && (
              <p className="text-xs text-gray-500 mt-1">
                Measuring your {baseMetrics.metrics.priorityCount} priority contacts
              </p>
            )}
            {typeof goingColdCount === 'number' && goingColdCount > 0 && (
              <p className="text-xs font-medium text-[#1E1E3F] mt-1">
                {goingColdCount} going cold right now
              </p>
            )}
            {nextStep && (
              <div className="mt-3 rounded-lg bg-[#F4F4FF] px-3 py-2 max-w-xs">
                <p className="text-xs font-medium text-[#1E1E3F]">Next step</p>
                <p className="text-xs text-gray-600 mt-0.5">{nextStep.text}</p>
                {nextStep.label && nextStep.onClick && (
                  <button
                    type="button"
                    onClick={nextStep.onClick}
                    className="mt-1.5 text-xs font-medium px-2.5 py-1 rounded-md bg-[#1E1E3F] text-white hover:bg-[#2D2D5F] transition-colors"
                  >
                    {nextStep.label}
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="h-16 w-px bg-gray-200 hidden lg:block" />
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 flex-grow">
          <MetricCard
            value={metrics.activeRelationships.count}
            trend="up"
            label="Active Relationships"
            explanation={metrics.activeRelationships.explanation}
            suggestion="The Going cold rail has an opener ready for each person past their rhythm"
          />
          
          <MetricCard
            value={`${metrics.weeklyActivity.percent > 0 ? '+' : ''}${metrics.weeklyActivity.percent}%`}
            trend={metrics.weeklyActivity.trend === 'up' ? 'up' : metrics.weeklyActivity.trend === 'down' ? 'down' : 'neutral'}
            label="Sent This Week"
            explanation={metrics.weeklyActivity.explanation}
            suggestion="Keep a steady weekly outreach rhythm"
          />
          
          <MetricCard
            value={metrics.networkReach.value}
            trend="up"
            label="Network Reach"
            explanation={metrics.networkReach.explanation}
            suggestion="Ask your network who could help with something, and see the intros worth making"
          />
        </div>
      </div>

      {/* Quick Actions */}
      {onViewChange && (
        <div className="mt-8 pt-6 border-t border-gray-100">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-gray-600">Views</h4>
          </div>
          <div className="mt-4 flex gap-4">
            <QuickAction
              icon="Users"
              label="Organize Network"
              description="Discover and manage groups"
              onClick={() => onViewChange('organize')}
            />
            <QuickAction
              icon="BarChart"
              label="Activity Timeline"
              description="Track communication patterns over time"
              onClick={() => onViewChange('analyze')}
            />
          </div>
        </div>
      )}
    </div>
  );
}

interface MetricCardProps {
  value: string | number;
  trend: 'up' | 'down' | 'neutral';
  label: string;
  explanation: string;
  suggestion: string;
}

function MetricCard({ value, trend, label, explanation, suggestion }: MetricCardProps) {
  return (
    <Tooltip content={
      <div className="space-y-2">
        <p>{explanation}</p>
        <p className="text-sm text-[#22C55E]">
          <Icon name="Lightbulb" size={16} className="inline mr-1" /> Tip: {suggestion}
        </p>
      </div>
    }>
      <div className="text-center p-4 rounded-xl hover:bg-gray-50 transition-colors cursor-help">
        <div className="text-3xl font-semibold text-[#1E1E3F] flex items-center justify-center gap-2">
          {value}
          {trend === 'up' && <Icon name="TrendingUp" size={20} className="text-[#22C55E]" />}
          {trend === 'down' && <Icon name="TrendingDown" size={20} className="text-red-500" />}
          {trend === 'neutral' && <Icon name="ArrowRight" size={20} className="text-[#3B82F6]" />}
        </div>
        <div className="text-sm text-gray-500 mt-1">{label}</div>
      </div>
    </Tooltip>
  );
}

interface QuickActionProps {
  icon: IconName;
  label: string;
  description: string;
  onClick: () => void;
}

function QuickAction({ icon, label, description, onClick }: QuickActionProps) {
  return (
    <button className="flex-1 p-4 rounded-xl border border-gray-200 hover:border-[#1E1E3F] hover:bg-[#F4F4FF] transition-all group" onClick={onClick}>
      <div className="text-2xl mb-2">
        <Icon name={icon} size={32} className="text-[#1E1E3F]" />
      </div>
      <div className="text-sm font-medium text-[#1E1E3F]">{label}</div>
      <div className="text-xs text-gray-500 group-hover:text-gray-600">{description}</div>
    </button>
  );
}