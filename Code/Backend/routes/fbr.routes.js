const express = require('express');
const router = express.Router();
const axios = require('axios');
const db = require('../config/db');

// Get FBR Reference Provinces (PRAL Section 5.1)
router.get('/provinces', (req, res) => {
  res.json({
    success: true,
    data: [
      { stateProvinceCode: 7, stateProvinceDesc: "PUNJAB" },
      { stateProvinceCode: 8, stateProvinceDesc: "SINDH" },
      { stateProvinceCode: 9, stateProvinceDesc: "KHYBER PAKHTUNKHWA" },
      { stateProvinceCode: 10, stateProvinceDesc: "BALOCHISTAN" },
      { stateProvinceCode: 11, stateProvinceDesc: "ISLAMABAD CAPITAL TERRITORY" }
    ]
  });
});

// Check Taxpayer Active Status (STATL - PRAL Section 5.11 & 5.12)
router.get('/statl-check/:ntn', async (req, res) => {
  const { ntn } = req.params;
  const cleanNtn = ntn.replace(/[^0-9]/g, '');

  try {
    // If real bearer token exists, query PRAL
    const bearerToken = process.env.FBR_BEARER_TOKEN;
    if (bearerToken && bearerToken !== 'your_pral_bearer_token_here' && bearerToken !== 'DEMO_SANDBOX_TOKEN') {
      const response = await axios.get(`https://gw.fbr.gov.pk/dist/v1/Get_Reg_Type`, {
        params: { Registration_No: cleanNtn },
        headers: { Authorization: `Bearer ${bearerToken}` },
        timeout: 5000
      });
      return res.json({ success: true, data: response.data });
    }

    // Default simulated active check
    res.json({
      success: true,
      data: {
        statusCode: "00",
        REGISTRATION_NO: cleanNtn,
        REGISTRATION_TYPE: cleanNtn.length >= 7 ? "Registered" : "Unregistered",
        STATUS: "Active",
        source: "PRAL STATL Simulator"
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get current FBR Configuration Settings
router.get('/settings', async (req, res) => {
  res.json({
    success: true,
    data: {
      environment: process.env.FBR_ENVIRONMENT || 'Sandbox',
      sandboxUrl: process.env.FBR_SANDBOX_URL || 'https://gw.fbr.gov.pk/di_data/v1/di/postinvoicedata_sb',
      productionUrl: process.env.FBR_PRODUCTION_URL || 'https://gw.fbr.gov.pk/di_data/v1/di/postinvoicedata',
      hasToken: Boolean(process.env.FBR_BEARER_TOKEN && process.env.FBR_BEARER_TOKEN !== 'your_pral_bearer_token_here'),
      sellerNtn: process.env.FBR_SELLER_NTN || '492019-1'
    }
  });
});

module.exports = router;
