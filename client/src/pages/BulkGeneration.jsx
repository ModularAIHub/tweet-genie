import React, { useState } from 'react';
import Masonry from 'react-masonry-css';
import Collapsible from '../components/Collapsible';
import { Switch } from '@headlessui/react';
import { ai, tweets, scheduling } from '../utils/api';
import dayjs from 'dayjs';
import moment from 'moment-timezone';

const BulkGeneration = () => {
  const [prompts, setPrompts] = useState('');
  const [promptList, setPromptList] = useState([]); // [{ prompt, isThread }]
  // outputs: { [idx]: { ...result, loading, error } }
  const [outputs, setOutputs] = useState({});
  const [discarded, setDiscarded] = useState([]); // array of idx
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [frequency, setFrequency] = useState('once_daily');
  const [startDate, setStartDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [timeOfDay, setTimeOfDay] = useState('09:00');
  const [daysOfWeek, setDaysOfWeek] = useState([]); // for custom
  const [schedulingStatus, setSchedulingStatus] = useState('idle');
  const [imageModal, setImageModal] = useState({ open: false, src: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showCreditInfo, setShowCreditInfo] = useState(true);

  const frequencyOptions = [
    { value: 'once_daily', label: 'Once a day' },
    { value: 'twice_daily', label: 'Twice a day' },
    { value: 'thrice_weekly', label: 'Thrice a week' },
    { value: 'four_times_weekly', label: 'Four times a week' },
    { value: 'custom', label: 'Custom days' },
  ];

  // Discard a generated output by idx
  const handleDiscard = (idx) => {
    setDiscarded(prev => [...prev, idx]);
  };

  // Schedule all non-discarded outputs
  const handleScheduleAll = () => {
    setShowScheduleModal(true);
  };

  // Helper to convert File to base64
  const fileToBase64 = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  // Schedule each output using the same logic as Compose
  const handleSchedule = async () => {
    setSchedulingStatus('scheduling');
    try {
      const toSchedule = Object.keys(outputs)
        .filter(idx => !discarded.includes(Number(idx)))
        .map(idx => outputs[idx]);
      if (toSchedule.length === 0) {
        setSchedulingStatus('error');
        alert('No tweets/threads to schedule.');
        return;
      }
      const timezone = moment.tz.guess();
      // Calculate scheduled times for each item based on frequency, startDate, timeOfDay, daysOfWeek
      let scheduledTimes = [];
      let current = dayjs(startDate + 'T' + timeOfDay);
      if (frequency === 'once_daily') {
        for (let i = 0; i < toSchedule.length; i++) {
          scheduledTimes.push(current.add(i, 'day').format());
        }
      } else if (frequency === 'twice_daily') {
        for (let i = 0; i < toSchedule.length; i++) {
          const dayOffset = Math.floor(i / 2);
          const hour = i % 2 === 0 ? 9 : 18;
          scheduledTimes.push(dayjs(startDate).add(dayOffset, 'day').hour(hour).minute(0).second(0).format());
        }
      } else if (frequency === 'thrice_weekly' || frequency === 'four_times_weekly') {
        const days = frequency === 'thrice_weekly' ? [1, 3, 5] : [0, 2, 4, 6];
        let idx = 0;
        let week = 0;
        while (scheduledTimes.length < toSchedule.length) {
          for (const d of days) {
            if (scheduledTimes.length < toSchedule.length) {
              scheduledTimes.push(dayjs(startDate).add(week, 'week').day(d).hour(Number(timeOfDay.split(':')[0])).minute(Number(timeOfDay.split(':')[1])).second(0).format());
            }
          }
          week++;
        }
      } else if (frequency === 'custom' && Array.isArray(daysOfWeek) && daysOfWeek.length > 0) {
        let idx = 0;
        let week = 0;
        while (scheduledTimes.length < toSchedule.length) {
          for (const d of daysOfWeek) {
            if (scheduledTimes.length < toSchedule.length) {
              scheduledTimes.push(dayjs(startDate).add(week, 'week').day(d).hour(Number(timeOfDay.split(':')[0])).minute(Number(timeOfDay.split(':')[1])).second(0).format());
            }
          }
          week++;
        }
      } else {
        // fallback: all at the same time
        for (let i = 0; i < toSchedule.length; i++) {
          scheduledTimes.push(current.format());
        }
      }

      // Schedule each item using the single scheduling API
      const results = [];
      for (let i = 0; i < toSchedule.length; i++) {
        const item = toSchedule[i];
        const scheduled_for = scheduledTimes[i];
        let media = [];
        if (item.isThread && Array.isArray(item.threadParts)) {
          // For threads, collect images for each part
          for (let j = 0; j < item.threadParts.length; j++) {
            if (item.images && item.images[j]) {
              const img = item.images[j];
              if (img instanceof File) {
                // Convert to base64
                // eslint-disable-next-line no-await-in-loop
                media.push(await fileToBase64(img));
              } else if (typeof img === 'string') {
                media.push(img);
              } else {
                media.push(null);
              }
            } else {
              media.push(null);
            }
          }
        } else {
          // Single tweet
          if (item.images && item.images[0]) {
            const img = item.images[0];
            if (img instanceof File) {
              // eslint-disable-next-line no-await-in-loop
              media.push(await fileToBase64(img));
            } else if (typeof img === 'string') {
              media.push(img);
            }
          }
        }
        // Compose payload
        const payload = item.isThread
          ? {
              thread: item.threadParts,
              threadMedia: (Array.isArray(media) && media.flat ? media.flat() : [].concat(...media)).filter(x => typeof x === 'string' && x.length > 0),
              scheduled_for,
              timezone,
            }
          : {
              content: item.text,
              media,
              scheduled_for,
              timezone,
            };
        try {
          // eslint-disable-next-line no-await-in-loop
          await scheduling.create(payload);
          results.push({ success: true });
        } catch (err) {
          // Log error details for debugging
          const details = err?.response?.data?.details;
          const errorMsg = err?.response?.data?.error || err.message;
          results.push({ success: false, error: errorMsg, details });
        }
      }
      const successCount = results.filter(r => r.success).length;
      const failCount = results.length - successCount;
      setSchedulingStatus('success');
      setShowScheduleModal(false);
      // Show error details if any failed
      if (failCount > 0) {
        const failed = results.filter(r => !r.success);
        const errorDetails = failed.map(f => f.error + (f.details ? ('\n' + f.details.join('\n')) : '')).join('\n---\n');
        alert(`Scheduled ${successCount} successfully. ${failCount} failed.\n\nDetails:\n${errorDetails}`);
      } else {
        alert(`Scheduled ${successCount} successfully.`);
      }
    } catch (err) {
      setSchedulingStatus('error');
      const details = err?.response?.data?.details;
      const errorMsg = err?.response?.data?.error || err.message;
      alert('Failed to schedule.' + (details ? ('\n' + details.join('\n')) : '') + '\n' + errorMsg);
    }
  };

  // Handle prompt input (one per line)
  // When textarea changes, update promptList
  const handlePromptsChange = (e) => {
    setPrompts(e.target.value);
    const lines = e.target.value.split('\n').map(p => p.trim()).filter(Boolean);
    setPromptList(lines.map((prompt, idx) => ({ prompt, isThread: false, id: idx })));
  };

  // Call backend for bulk generation directly (no queue)
  const toggleThread = (idx) => {
  setOutputs((prev) => {
    const updated = { ...prev };
    if (updated[idx]) {
      updated[idx] = { ...updated[idx], isThread: !updated[idx].isThread };
    }
    return updated;
  });
  setPromptList((prev) => prev.map((p, i) => i === idx ? { ...p, isThread: !p.isThread } : p));
};

const updateText = (idx, value) => {
  setOutputs((prev) => {
    const updated = { ...prev };
    if (updated[idx]) {
      updated[idx] = { ...updated[idx], text: value };
    }
    return updated;
  });
};

const handleImageUpload = (outputIdx, partIdx, files) => {
  setOutputs((prev) => {
    const updated = { ...prev };
    if (updated[outputIdx]) {
      const newImages = [...(updated[outputIdx].images || [])];
      newImages[partIdx] = files[0] || null;
      updated[outputIdx] = { ...updated[outputIdx], images: newImages };
    }
    return updated;
  });
};
const handleGenerate = async () => {
    setLoading(true);
    setError('');
    setOutputs({});
    try {
      const newOutputs = {};
      for (let idx = 0; idx < promptList.length; idx++) {
        const { prompt, isThread } = promptList[idx];
        setOutputs(prev => ({ ...prev, [idx]: { loading: true, prompt } }));
        try {
          const res = await ai.generate({ prompt, isThread });
          const data = res.data;
          if (isThread) {
            newOutputs[idx] = {
              prompt,
              text: data.content,
              isThread: true,
              threadParts: data.content.split('---').map(t => t.trim()).filter(Boolean),
              images: Array((data.threadCount || 1)).fill(null),
              id: idx,
              loading: false,
              error: null,
              appeared: true,
            };
          } else {
            let tweetText = data.content.split('---')[0].trim();
            if (tweetText.length > 280) tweetText = tweetText.slice(0, 280);
            newOutputs[idx] = {
              prompt,
              text: tweetText,
              isThread: false,
              threadParts: undefined,
              images: [null],
              id: idx,
              loading: false,
              error: null,
              appeared: true,
            };
          }
          setOutputs(prev => ({ ...prev, [idx]: newOutputs[idx] }));
        } catch (err) {
          newOutputs[idx] = { prompt, loading: false, error: err?.response?.data?.error || 'Failed to generate.' };
          setOutputs(prev => ({ ...prev, [idx]: newOutputs[idx] }));
        }
      }
      setPrompts('');
      setPromptList([]);
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to generate tweets/threads.');
    } finally {
      setLoading(false);
    }
  };

  const handleImageChange = (draftId, files) => {
    setImagesMap(prev => ({ ...prev, [draftId]: Array.from(files) }));
  };


  return (
    <div className="max-w-7xl mx-auto py-8 px-4 min-h-[80vh]">
      {/* Gradient header */}
      <div className="rounded-xl bg-gradient-to-r from-blue-700 via-blue-500 to-blue-300 p-1 mb-8 shadow-lg">
        <div className="bg-white rounded-xl p-6 flex flex-col md:flex-row md:items-center md:justify-between">
          <h1 className="text-3xl font-extrabold text-gray-900 mb-2 md:mb-0 flex items-center gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8h2a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2v-8a2 2 0 012-2h2M12 12v6m0 0l-3-3m3 3l3-3m-6-6V6a2 2 0 012-2h2a2 2 0 012 2v2" /></svg>
            Bulk Tweet & Thread Generation
          </h1>
          {showCreditInfo && (
            <div className="relative bg-blue-50 border border-blue-300 rounded-lg px-5 py-3 flex items-center gap-3 shadow-sm mt-4 md:mt-0">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M12 20a8 8 0 100-16 8 8 0 000 16z" /></svg>
              <span className="text-blue-900 text-sm font-medium">
                <b>How credits are deducted:</b> Each generated tweet or thread costs <b>1 credit</b>. (A thread, no matter how many tweets, is 1 credit. Images do not cost extra.)
              </span>
              <button onClick={() => setShowCreditInfo(false)} className="ml-3 text-blue-400 hover:text-blue-700 text-lg font-bold focus:outline-none">&times;</button>
            </div>
          )}
        </div>
      </div>
      <div className="mb-8 bg-blue-50 rounded-2xl shadow-2xl p-10 border border-blue-100">
        <div className="relative mb-6">
          <textarea
            className="peer w-full border-2 border-blue-200 bg-white rounded-xl p-4 min-h-[180px] text-base focus:ring-2 focus:ring-blue-400 focus:border-blue-400 transition shadow-sm placeholder-transparent resize-vertical"
            style={{ fontSize: '1.1rem', transition: 'border 0.2s, box-shadow 0.2s' }}
            value={prompts}
            onChange={handlePromptsChange}
            placeholder="Enter one prompt per line..."
            disabled={loading}
            id="bulk-prompts"
            aria-label="Prompts (one per line)"
          />
          <label htmlFor="bulk-prompts" className="absolute left-4 top-3 text-blue-500 text-base font-medium pointer-events-none transition-all duration-200 peer-focus:-top-5 peer-focus:text-sm peer-focus:text-blue-700 peer-placeholder-shown:top-3 peer-placeholder-shown:text-base peer-placeholder-shown:text-blue-400 bg-blue-50 px-1 rounded">
            Prompts (one per line)
          </label>
          <div className="absolute right-4 bottom-3 text-xs text-blue-400 select-none">
            {prompts.split('\n').filter(Boolean).length} lines
          </div>
        </div>
        <div className="text-xs text-blue-500 mb-4">Tip: Paste or type multiple prompts, one per line. Each line will generate a tweet or thread. You can edit or discard results after generation.</div>
        {promptList.length > 0 && (
          <div className="mt-4 space-y-2">
            {promptList.map((p, idx) => (
              <div key={p.id} className="flex items-center justify-between bg-gradient-to-r from-blue-100 to-blue-200 rounded-xl px-4 py-2 border border-blue-200 shadow-sm">
                <span className="text-sm text-gray-700 flex-1 truncate">{p.prompt}</span>
                <div className="flex items-center ml-4">
                  <label className="flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={p.isThread}
                      onChange={e => setPromptList(list => list.map((item, i) => i === idx ? { ...item, isThread: e.target.checked } : item))}
                      disabled={loading}
                      className="form-checkbox h-4 w-4 text-fuchsia-600 transition"
                    />
                    <span className="ml-2 text-xs text-gray-600">Thread</span>
                  </label>
                  {!p.isThread && <span className="ml-2 text-xs text-blue-500">Single Tweet</span>}
                </div>
              </div>
            ))}
            <div className="text-xs text-gray-500 mt-2">By default, all prompts generate single tweets. Toggle <b>Thread</b> for any prompt to generate a thread instead.</div>
          </div>
        )}
        <button
          className="mt-6 bg-gradient-to-r from-blue-600 to-blue-400 text-white px-10 py-3 text-lg font-semibold rounded-xl shadow-lg hover:from-blue-700 hover:to-blue-500 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-400"
          onClick={handleGenerate}
          disabled={loading || !prompts.trim()}
        >
          {loading ? (
            <span className="flex items-center gap-2"><span className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full"></span> Generating...</span>
          ) : 'Generate Tweets/Threads'}
        </button>
        {error && <div className="mt-4 text-red-600 font-medium">{error}</div>}
      </div>
  {Object.keys(outputs).length > 0 && (
        <>
          {/* Scheduling Modal UI */}
          {showScheduleModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60">
              <div className="bg-white rounded-lg shadow-lg p-8 max-w-2xl w-full relative">
                <button className="absolute top-2 right-2 text-gray-500 hover:text-gray-800 text-2xl" onClick={() => setShowScheduleModal(false)}>&times;</button>
                <h2 className="text-2xl font-bold mb-4">Schedule Your Generated Content</h2>
                <div className="mb-4">
                  <label className="block font-semibold mb-1">Frequency:</label>
                  <select className="border rounded px-3 py-2 w-full" value={frequency} onChange={e => setFrequency(e.target.value)}>
                    {frequencyOptions.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div className="mb-4">
                  <label className="block font-semibold mb-1">Start Date:</label>
                  <input type="date" className="border rounded px-3 py-2 w-full" value={startDate} onChange={e => setStartDate(e.target.value)} />
                </div>
                <div className="mb-4">
                  <label className="block font-semibold mb-1">Time of Day:</label>
                  <input type="time" className="border rounded px-3 py-2 w-full" value={timeOfDay} onChange={e => setTimeOfDay(e.target.value)} />
                </div>
                {frequency === 'custom' && (
                  <div className="mb-4">
                    <label className="block font-semibold mb-1">Days of Week:</label>
                    <div className="flex gap-2">
                      {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d, i) => (
                        <label key={i} className="flex items-center gap-1">
                          <input type="checkbox" checked={daysOfWeek.includes(i)} onChange={e => {
                            setDaysOfWeek(prev => e.target.checked ? [...prev, i] : prev.filter(x => x !== i));
                          }} />
                          <span>{d}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                {/* Optionally, allow image upload for each output if needed */}
                <button className="btn btn-primary px-6 py-2 mt-4" onClick={handleSchedule} disabled={schedulingStatus === 'scheduling'}>
                  {schedulingStatus === 'scheduling' ? 'Scheduling...' : 'Schedule'}
                </button>
              </div>
            </div>
          )}
          <>
            {/* Progress bar and count */}
            <div className="flex items-center mb-4">
              <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden mr-4">
                <div
                  className="h-2 bg-blue-500 transition-all duration-500"
                  style={{ width: `${(Object.values(outputs).filter(o => o.loading === false).length / (Object.keys(outputs).length || 1)) * 100}%` }}
                ></div>
              </div>
              <span className="text-sm text-gray-600 font-medium">
                {Object.values(outputs).filter(o => o.loading === false).length} of {Object.keys(outputs).length} generated
              </span>
              {loading && <span className="ml-3 animate-spin h-5 w-5 border-2 border-blue-400 border-t-transparent rounded-full"></span>}
            </div>
            {/* Schedule All button */}
            <div className="flex justify-end mb-2">
              <button
                className="btn btn-success px-5 py-2 rounded font-semibold shadow"
                onClick={handleScheduleAll}
                disabled={Object.keys(outputs).length === 0 || Object.keys(outputs).filter(idx => !discarded.includes(Number(idx))).length === 0}
              >
                Schedule All
              </button>
            </div>
            <Masonry
              breakpointCols={{ default: 2, 900: 1 }}
              className="flex w-full gap-4 min-h-[60vh]"
              columnClassName="masonry-column"
            >
              {Object.keys(outputs)
                .sort((a, b) => Number(a) - Number(b))
                .filter(idx => !discarded.includes(Number(idx)))
                .map((idx) => {
                  const output = outputs[idx];
                  return (
                    <div key={idx} className={`mb-4 transition-all duration-500 ${output.appeared ? 'animate-fadein' : ''}`}>
                      {output.loading ? (
                        <div className="bg-gray-100 rounded-lg p-6 border flex flex-col items-center justify-center min-h-[120px] animate-pulse">
                          <div className="w-2/3 h-4 bg-gray-300 rounded mb-2"></div>
                          <div className="w-1/2 h-3 bg-gray-200 rounded mb-1"></div>
                          <div className="w-1/3 h-3 bg-gray-200 rounded"></div>
                          <span className="mt-4 text-xs text-gray-400">Generating...</span>
                        </div>
                      ) : output.error ? (
                        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 font-medium">
                          Error: {output.error}
                        </div>
                      ) : (
                        <Collapsible
                          title={
                            <span>
                              <span className={`px-3 py-1 rounded-full text-xs font-semibold mr-3 transition-colors ${output.isThread ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                                {output.isThread ? 'Thread' : 'Single Tweet'}
                              </span>
                              <span className="text-gray-500 text-xs italic">Prompt: {output.prompt}</span>
                            </span>
                          }
                          defaultOpen={Object.keys(outputs).length <= 3}
                        >
                          {output.isThread ? (
                            <div className="grid grid-cols-1 gap-4 mb-2">
                              {output.threadParts?.map((part, tIdx) => (
                                <div key={tIdx} className="mb-2 bg-gray-50 rounded p-3 border flex flex-col">
                                  <textarea
                                    className="w-full border rounded p-2 mb-1 min-h-[90px] max-h-[300px] text-base focus:ring-2 focus:ring-purple-400 focus:border-purple-400 transition overflow-auto"
                                    style={{ resize: 'vertical', fontSize: '1.05rem' }}
                                    value={part}
                                    onChange={e => {
                                      setOutputs(prev => ({
                                        ...prev,
                                        [idx]: {
                                          ...prev[idx],
                                          threadParts: prev[idx].threadParts.map((tp, j) => j === tIdx ? e.target.value : tp),
                                          text: prev[idx].threadParts.map((tp, j) => j === tIdx ? e.target.value : tp).join('---'),
                                        }
                                      }));
                                    }}
                                    rows={4}
                                  />
                                  <div className="flex items-center space-x-4 mt-1">
                                    <input
                                      type="file"
                                      accept="image/*"
                                      onChange={e => handleImageUpload(Number(idx), tIdx, e.target.files)}
                                      disabled={loading}
                                    />
                                    {output.images[tIdx] && (
                                      <span className="text-xs text-green-600">{output.images[tIdx].name}</span>
                                    )}
                                    {output.images[tIdx] && (
                                      <img
                                        src={URL.createObjectURL(output.images[tIdx])}
                                        alt="preview"
                                        className="h-10 w-10 object-cover rounded border ml-2 cursor-pointer"
                                        onClick={() => setImageModal({ open: true, src: URL.createObjectURL(output.images[tIdx]) })}
                                      />
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="flex flex-col items-start gap-2 p-2">
                              <textarea
                                className="border rounded px-3 py-3 text-base max-w-full min-w-0 min-h-[90px] max-h-[300px] focus:ring-2 focus:ring-blue-400 focus:border-blue-400 transition overflow-auto"
                                style={{ width: '100%', resize: 'vertical', fontSize: '1.05rem' }}
                                value={output.text}
                                onChange={e => updateText(Number(idx), e.target.value)}
                                rows={Math.max(4, output.text.split('\n').length)}
                              />
                              <div className="flex items-center space-x-2 mt-1">
                                <input
                                  type="file"
                                  accept="image/*"
                                  onChange={e => handleImageUpload(Number(idx), 0, e.target.files)}
                                  disabled={loading}
                                />
                                {output.images[0] && (
                                  <span className="text-xs text-green-600">{output.images[0].name}</span>
                                )}
                                {output.images[0] && (
                                  <img
                                    src={URL.createObjectURL(output.images[0])}
                                    alt="preview"
                                    className="h-8 w-8 object-cover rounded border ml-2 cursor-pointer"
                                    onClick={() => setImageModal({ open: true, src: URL.createObjectURL(output.images[0]) })}
                                  />
                                )}
                              </div>
                            </div>
                          )}
                        </Collapsible>
                      )}
                      {/* Discard button */}
                      <div className="flex justify-end mt-2">
                        <button
                          className="btn btn-danger px-3 py-1 rounded text-xs font-semibold"
                          onClick={() => handleDiscard(Number(idx))}
                        >
                          Discard
                        </button>
                      </div>
                    </div>
                  );
                })}
            </Masonry>
            {/* Image Modal for full preview */}
            {imageModal.open && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-70" onClick={() => setImageModal({ open: false, src: null })}>
                <div className="relative max-w-3xl w-full flex flex-col items-center" onClick={e => e.stopPropagation()}>
                  <img src={imageModal.src} alt="Full preview" className="max-h-[80vh] max-w-full rounded shadow-lg border-4 border-white" />
                  <button className="mt-4 px-6 py-2 bg-white text-black rounded shadow font-semibold" onClick={() => setImageModal({ open: false, src: null })}>Close</button>
                </div>
              </div>
            )}
          </>
        </>
      )}
      
    </div>
  );
};

export default BulkGeneration;
