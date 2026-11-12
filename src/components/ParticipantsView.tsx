import React, { useState, useMemo, useEffect } from 'react';
import {
  Mail,
  Check,
  Send,
  Download,
  Trophy,
  Plus,
  Eye,
  X,
  Footprints,
  Sparkles,
  ChevronDown,
  ChevronUp,
  ExternalLink,
} from 'lucide-react';
import { Hike, ParticipantProfile } from '../types';
import {
  evaluateMilestonesForParticipant,
  MilestoneStatus,
} from '../utils/milestonesUtils';
import {
  generateMilestoneCardDataUrl,
  downloadMilestoneCardPng,
  sendMilestoneEmailNotification,
} from '../utils/milestoneCardGenerator';
import { parseSafeDate } from '../utils/dateUtils';
import { ToastType } from './Toast';

/**
 * Custom Hiker Icon (Ikonka turisty s batohem a holí)
 */
export const HikerIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    {/* Head */}
    <circle cx="13" cy="4" r="2" />
    {/* Backpack */}
    <path d="M7 9.5a2 2 0 0 1 2-2h1v6H8a1 1 0 0 1-1-1v-3Z" />
    {/* Body & Stride */}
    <path d="M10 13.5 8.5 21" />
    <path d="m12.5 13.5 3 4v3.5" />
    <path d="M11.5 7.5 10 13.5h2.5" />
    {/* Arm holding trekking pole */}
    <path d="m11.5 8.5 3.5 2.5 2.5-1" />
    {/* Trekking pole */}
    <path d="M18 7v14" />
  </svg>
);

interface ParticipantsViewProps {
  hikes: Hike[];
  participantProfiles: Record<string, ParticipantProfile>;
  onSaveProfile: (profile: ParticipantProfile) => Promise<void>;
  onNotify: (message: string, type?: ToastType) => void;
}

export const ParticipantsView: React.FC<ParticipantsViewProps> = ({
  hikes,
  participantProfiles,
  onSaveProfile,
  onNotify,
}) => {
  const currentYear = new Date().getFullYear().toString();
  const [selectedYear, setSelectedYear] = useState<string>(currentYear);
  const [emailInputs, setEmailInputs] = useState<Record<string, string>>({});
  const [savingName, setSavingName] = useState<string | null>(null);
  const [sendingKey, setSendingKey] = useState<string | null>(null);
  const [expandedParticipant, setExpandedParticipant] = useState<string | null>(null);

  // New participant manual addition
  const [newParticipantName, setNewParticipantName] = useState('');
  const [newParticipantEmail, setNewParticipantEmail] = useState('');

  // Standalone Milestone Card Preview Modal
  const [previewModal, setPreviewModal] = useState<{
    participantName: string;
    email: string;
    milestone: MilestoneStatus;
    cardDataUrl: string;
  } | null>(null);

  // Sync local email inputs with stored profiles
  useEffect(() => {
    const next: Record<string, string> = {};
    Object.values(participantProfiles).forEach((p) => {
      next[p.name] = p.email || '';
    });
    setEmailInputs((prev) => ({ ...prev, ...next }));
  }, [participantProfiles]);

  // Discover all unique participants from hikes + stored profiles
  const { allParticipants, availableYears } = useMemo(() => {
    const namesSet = new Set<string>();
    const yearsSet = new Set<number>([new Date().getFullYear()]);

    hikes.forEach((h) => {
      const d =
        parseSafeDate(h.rawDate) ||
        parseSafeDate(h.date?.split('–')[0]) ||
        parseSafeDate(h.date?.split('-')[0]);
      if (d && !isNaN(d.getFullYear())) yearsSet.add(d.getFullYear());

      if (h.participants) {
        h.participants.split(',').forEach((p) => {
          const clean = p.trim();
          if (clean) namesSet.add(clean);
        });
      }
    });

    Object.keys(participantProfiles).forEach((name) => {
      const clean = name.trim();
      if (clean) namesSet.add(clean);
    });

    return {
      allParticipants: Array.from(namesSet).sort((a, b) => a.localeCompare(b, 'cs')),
      availableYears: Array.from(yearsSet).sort((a, b) => b - a),
    };
  }, [hikes, participantProfiles]);

  // Compute stats & milestones per participant for the selected year
  const participantRows = useMemo(() => {
    return allParticipants.map((name) => {
      const matchingHikes = hikes.filter((h) => {
        if (!h.participants) return false;
        const d =
          parseSafeDate(h.rawDate) ||
          parseSafeDate(h.date?.split('–')[0]) ||
          parseSafeDate(h.date?.split('-')[0]);
        if (selectedYear !== 'all') {
          if (!d || d.getFullYear().toString() !== selectedYear) return false;
        }
        const parts = h.participants
          .split(',')
          .map((p) => p.trim().toLowerCase())
          .filter(Boolean);
        return parts.includes(name.toLowerCase());
      });

      const totalKm = matchingHikes.reduce((sum, h) => {
        const dist = typeof h.distance === 'string' ? parseFloat(h.distance) : h.distance;
        return sum + (isNaN(dist) ? 0 : dist);
      }, 0);

      const milestones = evaluateMilestonesForParticipant(hikes, name, selectedYear);
      const completedMilestones = milestones.filter((m) => m.isCompleted);

      return {
        name,
        hikesCount: matchingHikes.length,
        totalKm,
        milestones,
        completedMilestones,
        savedEmail: participantProfiles[name]?.email || '',
      };
    });
  }, [allParticipants, hikes, selectedYear, participantProfiles]);

  const handleSaveEmail = async (name: string) => {
    const emailVal = (emailInputs[name] ?? participantProfiles[name]?.email ?? '').trim();
    setSavingName(name);
    try {
      await onSaveProfile({
        name,
        email: emailVal,
        notifiedMilestones: participantProfiles[name]?.notifiedMilestones || [],
      });
      onNotify(
        emailVal
          ? `E-mail pro účastníka ${name} byl uložen (${emailVal})`
          : `E-mail u účastníka ${name} byl vymazán`,
        'success'
      );
    } finally {
      setSavingName(null);
    }
  };

  const handleAddManualParticipant = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = newParticipantName.trim();
    const cleanEmail = newParticipantEmail.trim();
    if (!cleanName) return;

    await onSaveProfile({
      name: cleanName,
      email: cleanEmail,
      notifiedMilestones: [],
    });
    setEmailInputs((prev) => ({ ...prev, [cleanName]: cleanEmail }));
    setNewParticipantName('');
    setNewParticipantEmail('');
    onNotify(`Účastník ${cleanName} byl přidán do seznamu`, 'success');
  };

  const handlePreviewMilestone = (
    participantName: string,
    email: string,
    milestone: MilestoneStatus
  ) => {
    const cardDataUrl = generateMilestoneCardDataUrl(milestone, participantName);
    setPreviewModal({
      participantName,
      email,
      milestone,
      cardDataUrl,
    });
  };

  const handleSendMilestoneEmail = async (
    participantName: string,
    milestone: MilestoneStatus
  ) => {
    const email = (
      emailInputs[participantName] ??
      participantProfiles[participantName]?.email ??
      ''
    ).trim();

    if (!email || !email.includes('@')) {
      onNotify(
        `Nejprve vyplňte platnou e-mailovou adresu u účastníka ${participantName}.`,
        'warning'
      );
      return;
    }

    // Save email if not saved yet
    if (email !== participantProfiles[participantName]?.email) {
      await onSaveProfile({
        name: participantName,
        email,
        notifiedMilestones: participantProfiles[participantName]?.notifiedMilestones || [],
      });
    }

    const key = `${participantName}_${milestone.id}`;
    setSendingKey(key);
    try {
      const res = await sendMilestoneEmailNotification({
        participantName,
        email,
        milestone,
      });

      // Also download the standalone PNG milestone card so the user has the attachment ready
      downloadMilestoneCardPng(milestone, participantName);

      if (res.sentViaApi) {
        onNotify(
          `E-mail s milníkem „${milestone.title}“ byl odeslán na ${email} (přiložený milník byl také stažen).`,
          'success'
        );
      } else {
        // Open default mail client with pre-filled body and downloaded standalone milestone card
        window.location.href = res.mailtoUrl;
        onNotify(
          `Otevírám e-mailového klienta pro ${email} – samostatný milník „${milestone.title}“ byl stažen pro přiložení.`,
          'success'
        );
      }
    } finally {
      setSendingKey(null);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
      {/* Top Header */}
      <div className="bg-white rounded-3xl border border-stone-200/90 shadow-xs p-5 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-start sm:items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white flex items-center justify-center shadow-md shrink-0">
              <HikerIcon className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-extrabold text-stone-900 tracking-tight">
                Účastníci a e-mailové notifikace milníků
              </h1>
              <p className="text-xs sm:text-sm text-stone-500 mt-0.5">
                Přiřaďte účastníkům e-mailovou adresu – po splnění milníku se automaticky odešle oznámení se samostatnou kartou milníku
              </p>
            </div>
          </div>

          {/* Year selector for viewing completed milestones */}
          <div className="flex items-center gap-2 self-start sm:self-center bg-stone-50 border border-stone-200/80 rounded-2xl px-3.5 py-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-stone-500">
              Hodnocený rok:
            </span>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              className="bg-white border border-stone-200 rounded-xl px-2.5 py-1 text-xs font-bold text-stone-800 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            >
              <option value="all">Všechny roky</option>
              {availableYears.map((y) => (
                <option key={y} value={y.toString()}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Quick form to add a new participant */}
        <form
          onSubmit={handleAddManualParticipant}
          className="pt-4 border-t border-stone-100 flex flex-col sm:flex-row items-stretch sm:items-end gap-3"
        >
          <div className="flex-1">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-stone-500 mb-1">
              Přidat dalšího účastníka
            </label>
            <input
              type="text"
              value={newParticipantName}
              onChange={(e) => setNewParticipantName(e.target.value)}
              placeholder="Jméno účastníka..."
              className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-xs font-medium text-stone-800 outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            />
          </div>
          <div className="flex-1">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-stone-500 mb-1">
              E-mailová adresa
            </label>
            <input
              type="email"
              value={newParticipantEmail}
              onChange={(e) => setNewParticipantEmail(e.target.value)}
              placeholder="turista@email.cz"
              className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-xs font-medium text-stone-800 outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            />
          </div>
          <button
            type="submit"
            className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-xs transition-colors cursor-pointer shrink-0 h-[34px]"
          >
            <Plus className="w-4 h-4" />
            <span>Přidat účastníka</span>
          </button>
        </form>
      </div>

      {/* Participants List */}
      <div className="space-y-3.5">
        {participantRows.length === 0 ? (
          <div className="bg-white rounded-2xl border border-stone-200 p-8 text-center text-stone-400 text-sm">
            Zatím nebyli nalezeni žádní účastníci. Přidejte účastníka výše nebo u záznamu v Zápisníku.
          </div>
        ) : (
          participantRows.map((row) => {
            const currentInput = emailInputs[row.name] ?? row.savedEmail;
            const isDirty = currentInput.trim() !== row.savedEmail.trim();
            const isExpanded = expandedParticipant === row.name;

            return (
              <div
                key={row.name}
                className="bg-white rounded-2xl border border-stone-200/90 shadow-2xs overflow-hidden transition-all"
              >
                <div className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  {/* Left: Participant Name & Stats */}
                  <div className="flex items-center gap-3.5 min-w-[220px]">
                    <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center shrink-0">
                      <HikerIcon className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="font-extrabold text-stone-900 text-sm sm:text-base flex items-center gap-2">
                        <span>{row.name}</span>
                        {row.savedEmail && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full">
                            <Check className="w-3 h-3" />
                            <span>Aktivní notifikace</span>
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-stone-500 flex flex-wrap items-center gap-3 mt-0.5">
                        <span className="inline-flex items-center gap-1">
                          <Footprints className="w-3.5 h-3.5 text-stone-400" />
                          <span>
                            <strong className="text-stone-700">{row.hikesCount}</strong> výšlapů (
                            <strong className="text-emerald-700">{row.totalKm.toFixed(1)} km</strong>)
                          </span>
                        </span>
                        <span className="inline-flex items-center gap-1 text-amber-700 font-semibold">
                          <Trophy className="w-3.5 h-3.5 text-amber-500" />
                          <span>
                            {row.completedMilestones.length} / {row.milestones.length} milníků
                          </span>
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Center: Email Input & Save Button */}
                  <div className="flex-1 max-w-md flex items-center gap-2">
                    <div className="relative flex-1">
                      <Mail className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="email"
                        value={currentInput}
                        onChange={(e) =>
                          setEmailInputs((prev) => ({ ...prev, [row.name]: e.target.value }))
                        }
                        placeholder="Zadejte e-mail pro zasílání milníků..."
                        className="w-full bg-stone-50 focus:bg-white border border-stone-200 rounded-xl pl-9 pr-3 py-2 text-xs font-medium text-stone-800 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => handleSaveEmail(row.name)}
                      disabled={savingName === row.name}
                      className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shrink-0 ${
                        isDirty
                          ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs'
                          : 'bg-stone-100 hover:bg-stone-200 text-stone-700'
                      }`}
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>{savingName === row.name ? 'Ukládám...' : 'Uložit'}</span>
                    </button>
                  </div>

                  {/* Right: Toggle Completed Milestones & Manual Send */}
                  <div className="flex items-center gap-2 self-end lg:self-center">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedParticipant(isExpanded ? null : row.name)
                      }
                      className="bg-stone-50 hover:bg-stone-100 border border-stone-200 text-stone-700 px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Trophy className="w-3.5 h-3.5 text-amber-500" />
                      <span>Milníky ({row.completedMilestones.length})</span>
                      {isExpanded ? (
                        <ChevronUp className="w-3.5 h-3.5 text-stone-400" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5 text-stone-400" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Expanded Panel: Completed Milestones for this Participant */}
                {isExpanded && (
                  <div className="border-t border-stone-100 bg-stone-50/70 p-4 sm:p-5 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-xs font-extrabold uppercase tracking-wider text-stone-600 flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                        <span>
                          Splněné milníky účastníka {row.name} (
                          {selectedYear === 'all' ? 'Všechny roky' : `Rok ${selectedYear}`})
                        </span>
                      </h3>
                      <span className="text-[11px] text-stone-500">
                        Kliknutím zobrazíte samostatnou kartu milníku nebo ji odešlete na e-mail
                      </span>
                    </div>

                    {row.completedMilestones.length === 0 ? (
                      <div className="text-xs text-stone-400 italic py-4 text-center bg-white rounded-xl border border-dashed border-stone-200">
                        V tomto období zatím účastník {row.name} nesplnil žádný milník.
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                        {row.completedMilestones.map((m) => {
                          const sendKey = `${row.name}_${m.id}`;
                          const isSending = sendingKey === sendKey;
                          return (
                            <div
                              key={m.id}
                              className="bg-white border border-stone-200/90 rounded-xl p-3 flex items-center justify-between gap-3 shadow-2xs"
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <span className="text-2xl shrink-0">{m.icon}</span>
                                <div className="min-w-0">
                                  <div className="font-bold text-xs text-stone-900 truncate">
                                    {m.title}
                                  </div>
                                  <div className="text-[11px] text-stone-500 truncate">
                                    {m.completedDate
                                      ? `Splněno: ${m.completedDate}`
                                      : m.explanation}
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                  type="button"
                                  onClick={() =>
                                    handlePreviewMilestone(row.name, currentInput, m)
                                  }
                                  className="p-1.5 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-700 transition-colors cursor-pointer"
                                  title="Zobrazit samostatný milník"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => downloadMilestoneCardPng(m, row.name)}
                                  className="p-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200/80 transition-colors cursor-pointer"
                                  title="Stáhnout samostatný milník (PNG)"
                                >
                                  <Download className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  disabled={isSending}
                                  onClick={() => handleSendMilestoneEmail(row.name, m)}
                                  className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-[11px] font-bold flex items-center gap-1 transition-colors cursor-pointer"
                                  title="Odeslat oznámení o splnění milníku na e-mail"
                                >
                                  <Send className="w-3 h-3" />
                                  <span>{isSending ? 'Odesílám...' : 'Odeslat'}</span>
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Standalone Milestone Preview & Email Modal */}
      {previewModal && (
        <div className="fixed inset-0 z-[2000] bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-2xl w-full p-5 sm:p-6 shadow-2xl border border-stone-200 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base sm:text-lg font-extrabold text-stone-900">
                  Samostatná karta milníku – {previewModal.milestone.title}
                </h3>
                <p className="text-xs text-stone-500">
                  Účastník: <strong>{previewModal.participantName}</strong>
                  {previewModal.email ? ` (${previewModal.email})` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewModal(null)}
                className="p-2 rounded-xl text-stone-400 hover:text-stone-700 hover:bg-stone-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Rendered Standalone Milestone PNG Image */}
            <div className="rounded-2xl overflow-hidden border border-stone-200 bg-stone-100 shadow-inner">
              <img
                src={previewModal.cardDataUrl}
                alt={previewModal.milestone.title}
                className="w-full h-auto block"
              />
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() =>
                  downloadMilestoneCardPng(
                    previewModal.milestone,
                    previewModal.participantName
                  )
                }
                className="bg-stone-100 hover:bg-stone-200 text-stone-800 px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <Download className="w-4 h-4 text-emerald-600" />
                <span>Stáhnout samostatný milník (PNG)</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  handleSendMilestoneEmail(
                    previewModal.participantName,
                    previewModal.milestone
                  )
                }
                className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm cursor-pointer"
              >
                <Send className="w-4 h-4" />
                <span>Odeslat oznámení s milníkem na e-mail</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
