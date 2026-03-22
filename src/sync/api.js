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

module.exports = {
  testConnection,
  getMaps,
  uploadRecording,
  createMapFromRecording,
  getTemplates
};
