const fetch = require('node-fetch');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

/**
 * Test connection to MapVS.com API by validating the token.
 * @param {string} token - Bearer token (vs_xxxx)
 * @param {string} apiUrl - Base API URL
 * @returns {Promise<boolean>}
 */
async function testConnection(token, apiUrl) {
  try {
    const response = await fetch(`${apiUrl}/maps`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      },
      timeout: 10000
    });
    return response.ok;
  } catch (err) {
    console.error('Connection test failed:', err.message);
    return false;
  }
}

/**
 * Get list of maps from MapVS.com.
 * @param {string} token - Bearer token
 * @param {string} apiUrl - Base API URL
 * @returns {Promise<Array<{ id: string, name: string }>>}
 */
async function getMaps(token, apiUrl) {
  const response = await fetch(`${apiUrl}/maps`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json'
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch maps: ${response.status} ${text}`);
  }

  const data = await response.json();
  return data.maps || data || [];
}

/**
 * Upload a recording to an existing map on MapVS.com.
 * Sends recording JSON + screenshot files as multipart form data.
 * @param {string} token - Bearer token
 * @param {string} apiUrl - Base API URL
 * @param {string} mapId - Target map ID
 * @param {object} recording - Recording session data with steps
 * @returns {Promise<{ map_id: string, stages_created: number }>}
 */
async function uploadRecording(token, apiUrl, mapId, recording) {
  const form = new FormData();

  // Add recording metadata (without file paths, add screenshot references)
  const cleanedSteps = recording.steps.map((step, index) => ({
    ...step,
    screenshot_key: `screenshot_${index}`
  }));

  const metadata = {
    sessionId: recording.sessionId,
    mode: recording.mode,
    startTime: recording.startTime,
    endTime: recording.endTime,
    steps: cleanedSteps
  };

  form.append('recording', JSON.stringify(metadata), {
    contentType: 'application/json'
  });

  // Attach screenshot files
  for (let i = 0; i < recording.steps.length; i++) {
    const step = recording.steps[i];
    if (step.screenshot_path && fs.existsSync(step.screenshot_path)) {
      form.append(
        `screenshot_${i}`,
        fs.createReadStream(step.screenshot_path),
        {
          filename: path.basename(step.screenshot_path),
          contentType: 'image/png'
        }
      );
    }
  }

  const response = await fetch(`${apiUrl}/maps/${mapId}/recordings`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      ...form.getHeaders()
    },
    body: form
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Upload failed: ${response.status} ${text}`);
  }

  return await response.json();
}

/**
 * Create a new map from a recording on MapVS.com.
 * @param {string} token - Bearer token
 * @param {string} apiUrl - Base API URL
 * @param {string} name - Name for the new map
 * @param {object} recording - Recording session data with steps
 * @returns {Promise<{ map_id: string }>}
 */
async function createMapFromRecording(token, apiUrl, name, recording) {
  const form = new FormData();

  const cleanedSteps = recording.steps.map((step, index) => ({
    ...step,
    screenshot_key: `screenshot_${index}`
  }));

  const metadata = {
    name,
    sessionId: recording.sessionId,
    mode: recording.mode,
    startTime: recording.startTime,
    endTime: recording.endTime,
    steps: cleanedSteps
  };

  form.append('recording', JSON.stringify(metadata), {
    contentType: 'application/json'
  });

  // Attach screenshot files
  for (let i = 0; i < recording.steps.length; i++) {
    const step = recording.steps[i];
    if (step.screenshot_path && fs.existsSync(step.screenshot_path)) {
      form.append(
        `screenshot_${i}`,
        fs.createReadStream(step.screenshot_path),
        {
          filename: path.basename(step.screenshot_path),
          contentType: 'image/png'
        }
      );
    }
  }

  const response = await fetch(`${apiUrl}/maps`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      ...form.getHeaders()
    },
    body: form
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Map creation failed: ${response.status} ${text}`);
  }

  return await response.json();
}

/**
 * Get available recording templates from MapVS.com.
 * @param {string} token - Bearer token
 * @param {string} apiUrl - Base API URL
 * @returns {Promise<Array<{ id: string, name: string, industry: string, steps: Array<{ name: string, description: string }> }>>}
 */
async function getTemplates(token, apiUrl) {
  const response = await fetch(`${apiUrl}/templates`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json'
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch templates: ${response.status} ${text}`);
  }

  const data = await response.json();
  return data.templates || data || [];
}

/**
 * Get unread notification count from MapVS.com.
 * @param {string} token - Bearer token
 * @param {string} apiUrl - Base API URL
 * @returns {Promise<number>}
 */
async function getNotificationCount(token, apiUrl) {
  try {
    const response = await fetch(`${apiUrl}/notifications/count`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      },
      timeout: 10000
    });

    if (!response.ok) return 0;
    const data = await response.json();
    return data.count || 0;
  } catch (err) {
    console.error('Failed to fetch notification count:', err.message);
    return 0;
  }
}

/**
 * Get notifications list from MapVS.com.
 * @param {string} token - Bearer token
 * @param {string} apiUrl - Base API URL
 * @returns {Promise<Array<{ id: string, title: string, message: string, read: boolean, created_at: string }>>}
 */
async function getNotifications(token, apiUrl) {
  const response = await fetch(`${apiUrl}/notifications`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json'
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch notifications: ${response.status} ${text}`);
  }

  const data = await response.json();
  return data.notifications || data || [];
}

/**
 * Get quick stats (total maps count) from MapVS.com.
 * @param {string} token - Bearer token
 * @param {string} apiUrl - Base API URL
 * @returns {Promise<{ total_maps: number }>}
 */
async function getStats(token, apiUrl) {
  try {
    const response = await fetch(`${apiUrl}/stats`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      },
      timeout: 10000
    });

    if (!response.ok) {
      // Fallback: use maps count
      const maps = await getMaps(token, apiUrl);
      return { total_maps: Array.isArray(maps) ? maps.length : 0 };
    }
    const data = await response.json();
    return data;
  } catch (err) {
    console.error('Failed to fetch stats:', err.message);
    return { total_maps: 0 };
  }
}

/**
 * Get active presence (who's viewing/editing a map) from MapVS.com.
 * @param {string} token - Bearer token
 * @param {string} apiUrl - Base API URL
 * @param {string} mapId - Map ID
 * @returns {Promise<{ active_users: Array<{ user_id: number, user_name: string }>, count: number }>}
 */
async function getMapPresence(token, apiUrl, mapId) {
  try {
    const response = await fetch(`${apiUrl}/collab/${mapId}/presence`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      },
      timeout: 10000
    });

    if (!response.ok) return { active_users: [], count: 0 };
    const data = await response.json();
    // Unwrap API v1 {status, data} wrapper
    return data.data || data;
  } catch (err) {
    console.error('Failed to fetch map presence:', err.message);
    return { active_users: [], count: 0 };
  }
}

/**
 * Generic authenticated GET request to any API path.
 * @param {string} token - Bearer token
 * @param {string} apiUrl - Base API URL
 * @param {string} apiPath - Path to append (e.g. '/live-recording/active')
 * @returns {Promise<object>}
 */
async function apiRequest(token, apiUrl, apiPath) {
  const url = `${apiUrl}${apiPath}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json'
    },
    timeout: 10000
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API request failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  // Unwrap API v1 {status, data} wrapper if present
  return data.data !== undefined ? data.data : data;
}

/**
 * Get runs for a specific map.
 * @param {string} token - Bearer token
 * @param {string} apiUrl - Base API URL
 * @param {string} mapId - Map ID
 * @returns {Promise<Array>}
 */
async function getMapRuns(token, apiUrl, mapId) {
  const response = await fetch(`${apiUrl}/maps/${mapId}/runs`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json'
    },
    timeout: 10000
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch runs: ${response.status} ${text}`);
  }

  const data = await response.json();
  return data.runs || data.data || data || [];
}

/**
 * POST a JSON body to an API endpoint.
 * @param {string} token - Bearer token
 * @param {string} apiUrl - Base API URL
 * @param {string} apiPath - API path (e.g. /video/123/pose-analysis)
 * @param {object} body - JSON body to send
 * @returns {Promise<any>}
 */
async function apiPost(token, apiUrl, apiPath, body = {}) {
  const url = `${apiUrl}${apiPath}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body),
    timeout: 120000
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API POST failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  return data.data !== undefined ? data.data : data;
}

/**
 * Upload a local video file to the API via multipart/form-data.
 * @param {string} token - Bearer token
 * @param {string} apiUrl - Base API URL
 * @param {string} filePath - Absolute path to the local video file
 * @returns {Promise<any>} - Upload response with video ID
 */
async function uploadVideoFile(token, apiUrl, filePath) {
  const fs = require('fs');
  const path = require('path');
  const FormData = require('form-data');

  const fileName = path.basename(filePath);
  const fileStream = fs.createReadStream(filePath);
  const form = new FormData();
  form.append('video', fileStream, fileName);
  form.append('skip_analysis', '1');

  const url = `${apiUrl}/video/upload`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      ...form.getHeaders()
    },
    body: form,
    timeout: 300000
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Video upload failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  return data.data !== undefined ? data.data : data;
}

module.exports = {
  testConnection,
  getMaps,
  uploadRecording,
  createMapFromRecording,
  getTemplates,
  getNotificationCount,
  getNotifications,
  getStats,
  getMapPresence,
  apiRequest,
  apiPost,
  uploadVideoFile,
  getMapRuns
};
