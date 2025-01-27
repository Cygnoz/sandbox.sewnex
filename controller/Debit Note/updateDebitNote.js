
const mongoose = require('mongoose');
const DebitNote = require('../../database/model/debitNote');
const Bill = require('../../database/model/bills');
const TrialBalance = require("../../database/model/trialBalance");
const ItemTrack = require("../../database/model/itemTrack");
const { dataExist, validation, calculation, accounts } = require("../Debit Note/debitNoteController");
const { cleanData } = require("../../services/cleanData");



// Update Debit Note 
exports.updateDebitNote = async (req, res) => {
    console.log("Update debit note:", req.body);
  
    try {
      const { organizationId } = req.user;
      const { debitId } = req.params;   
      
      // Fetch existing credit note
      const existingDebitNote = await getExistingDebitNote(debitId, organizationId);

      const existingDebitNoteItems = existingDebitNote.items;      

      // Clean input data
      const cleanedData = cleanData(req.body);

      cleanedData.depositAccountId = cleanedData.depositTo || undefined;

      const { supplierId, items, billId } = cleanedData;

      const itemIds = items.map(item => item.itemId);

      // Fetch the latest debit note for the given supplierId and organizationId
      await getLatestDebitNote(debitId, organizationId, supplierId, billId, itemIds, res);
    
      // Validate _id's
      const validateAllIds = validateIds({
        supplierId,
        billId,
        itemIds,
        cleanedData,
        existingDebitNote
      });
      if (validateAllIds) {
        return res.status(400).json({ message: validateAllIds });
      }

      // Fetch related data
      const { organizationExists, supplierExist, billExist, defaultAccount, supplierAccount } = await dataExist.dataExist( organizationId, supplierId, billId );  
      
      //Data Exist Validation
      if (!validation.validateOrganizationTaxCurrency( organizationExists, supplierExist, billExist, res )) return;

      const { itemTable } = await dataExist.itemDataExists( organizationId, items );

    //   const validationData = {cleanedData, customerExist, invoiceExist, items, itemTable, organizationExists, existingDebitNoteItems};

      // Validate Inputs
      if (!validateInputs( cleanedData, supplierExist, billExist, items, itemTable, organizationExists, existingDebitNoteItems, res)) return;
  
      // Tax Type 
      calculation.taxType(cleanedData, supplierExist);

      //Default Account
      const { defAcc, depositAccount, error } = await accounts.defaultAccounting( cleanedData, defaultAccount, organizationExists );
      if (error) { 
        res.status(400).json({ message: error }); 
        return false; 
      }
  
      // Calculate Debit Note
      if (!calculation.calculateDebitNote(cleanedData, res)) return;

      //Purchase Journal      
      if (!accounts.purchaseJournal( cleanedData, res )) return; 

      const mongooseDocument = DebitNote.hydrate(existingDebitNote);
      Object.assign(mongooseDocument, cleanedData);
      const savedDebitNote = await mongooseDocument.save();
      if (!savedDebitNote) {
        return res.status(500).json({ message: "Failed to update debit note" });
      }

      //Journal
      await journal( savedDebitNote, defAcc, supplierAccount, depositAccount );
      
      //Item Track
      await itemTrack( savedDebitNote, itemTable, organizationId, debitId );

      // Update Purchase Bill
      await updateBillWithDebitNote(billId, items, organizationId, supplierId, debitId);
  
      res.status(200).json({ message: "Debit note updated successfully", savedDebitNote });
      // console.log("Debit Note updated successfully:", savedDebitNote);  
    } catch (error) {
      console.error("Error updating debit note:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  };






  // Get Existing Debit Note
async function getExistingDebitNote(debitId, organizationId) {
  const existingDebitNote = await DebitNote.findOne({ _id: debitId, organizationId });
  if (!existingDebitNote) {
      console.log("Debit note not found with ID:", debitId);
      return res.status(404).json({ message: "Debit note not found" });
  }
  return existingDebitNote;
}




// Get Latest Debit Note
async function getLatestDebitNote(debitId, organizationId, supplierId, billId, itemIds, res) {
  const latestDebitNote = await DebitNote.findOne({ 
      organizationId, 
      supplierId,
      billId, 
      "items.itemId": { $in: itemIds },
  }).sort({ createdDateTime: -1 }); // Sort by createdDateTime in descending order

  if (!latestDebitNote) {
      console.log("No debit note found for this supplier.");
      return res.status(404).json({ message: "No debit note found for this supplier." });
  }

  // Check if the provided debitId matches the latest one
  if (latestDebitNote._id.toString() !== debitId) {
    return res.status(400).json({
      message: "Only the latest debit note can be edited."
    });
  }

  return latestDebitNote;
}





  function validateIds({ supplierId, billId, itemIds, cleanedData, existingDebitNote }) {
    // Validate Supplier ID
    if (!mongoose.Types.ObjectId.isValid(supplierId) || supplierId.length !== 24) {
      return res.status(400).json({ message: `Invalid supplier ID: ${supplierId}` });
    }
  
    // Validate Bill ID
    if (!mongoose.Types.ObjectId.isValid(billId) || billId.length !== 24) {
      return res.status(400).json({ message: `Invalid bill ID: ${billId}` });
    }
  
    // Validate Item IDs
    const invalidItemIds = itemIds.filter(itemId => !mongoose.Types.ObjectId.isValid(itemId) || itemId.length !== 24);
    if (invalidItemIds.length > 0) {
      return `Invalid item IDs: ${invalidItemIds.join(', ')}`;
    }
  
    // Check for duplicate Item IDs
    const uniqueItemIds = new Set(itemIds);
    if (uniqueItemIds.size !== itemIds.length) {
      return "Duplicate Item found in the list.";
    }

    // Ensure `debitNote` field matches the existing order
    if (cleanedData.debitNote !== existingDebitNote.debitNote) {
      return res.status(400).json({
        message: `The provided debitNote does not match the existing record. Expected: ${existingCreditNote.creditNote}`,
      });
    }
  
    // Return null if all validations pass
    return null;
  }







  const updateBillWithDebitNote = async (billId, items, organizationId, supplierId, debitId) => {
    try {
      for (const item of items) {
        // Step 1: Fetch all debit notes matching the organizationId, supplierId, billId, and itemId,
        // excluding the current creditId
        const matchingDebitNotes = await DebitNote.find({
          organizationId,
          supplierId,
          billId,
          "items.itemId": item.itemId,
          _id: { $ne: debitId }, // Exclude the current debitId
        });
  
        // Step 2: Calculate the total quantity from the matched debit notes
        let previousReturnQuantity = 0;
        for (const debitNote of matchingDebitNotes) {
          const matchedItem = debitNote.items.find(i => i.itemId.toString() === item.itemId.toString());
          if (matchedItem) {
            previousReturnQuantity += matchedItem.itemQuantity; // Sum up quantities
          }
        }
  
        // Step 3: Add the quantity of the item being updated to the previous return quantity
        const newReturnQuantity = previousReturnQuantity + item.itemQuantity;
  
        // Step 4: Update the returnQuantity in the purchase bill
        await Bill.findOneAndUpdate(
          { _id: billId, 'items.itemId': item.itemId },
          {
            $set: { 'items.$.returnQuantity': newReturnQuantity },
          }
        );
      }
    } catch (error) {
      console.error("Error updating bill with returnQuantity:", error);
      throw new Error("Failed to update bill with debit note details.");
    }
  };
  








//Validate inputs
function validateInputs( data, supplierExist, billExist, items, itemExists, organizationExists, existingDebitNoteItems, res) {

  const validationErrors = validateDebitNoteData(data, supplierExist, billExist, items, itemExists, organizationExists, existingDebitNoteItems);  

  if (validationErrors.length > 0) {
    res.status(400).json({ message: validationErrors.join(", ") });
    return false;
  }
  return true;
}

//Validate Data
function validateDebitNoteData(data, supplierExist, billExist, items, itemTable, organizationExists, existingDebitNoteItems) {
  
  const errors = [];

  //Basic Info
  validateReqFields( data, supplierExist, errors );
  validateItemTable(items, itemTable, errors);
  validateBillData(data, items, billExist, existingDebitNoteItems, errors);

  //OtherDetails
  validateIntegerFields(['totalItem'], data, errors);
  validateFloatFields(['subTotal','cgst','sgst','igst','vat','totalTaxAmount','grandTotal'], data, errors);

  //Tax Details
  validateSourceOfSupply(data.sourceOfSupply, organizationExists, errors);
  validateDestinationOfSupply(data.destinationOfSupply, organizationExists, errors);
  validateBillType(data.billType, errors);
  validatePaymentMode(data.paymentMode, errors);

  return errors;
}



// Field validation utility
function validateField(condition, errorMsg, errors) {
  if (condition) errors.push(errorMsg);
}


//Valid Req Fields
function validateReqFields( data, supplierExist, errors ) {
    validateField( typeof data.supplierId === 'undefined', "Please select a Supplier", errors  );
    
    validateField( supplierExist.taxType == 'GST' && typeof data.sourceOfSupply === 'undefined', "Source of supply required", errors  );
    validateField( supplierExist.taxType == 'GST' && typeof data.destinationOfSupply === 'undefined', "Destination of supply required", errors  );
    
    validateField( typeof data.items === 'undefined', "Select an item", errors  );
    validateField( Array.isArray(data.items) && data.items.length === 0, "Select an item", errors );
    
    // validateField( typeof data.billNumber === 'undefined', "Select an bill number", errors  );
    validateField( typeof data.billType === 'undefined', "Select an bill type", errors  );
    validateField( typeof data.paymentMode === 'undefined', "Select payment mode", errors  );
    
    validateField( typeof data.supplierDebitDate === 'undefined', "Select supplier debit date", errors  );
    validateField( typeof data.paymentMode === 'undefined', "Select payment mode", errors  );
    
    validateField( typeof data.grandTotal === 'undefined', "Enter the amount", errors  );
    validateField( data.paymentMode === 'Cash' && typeof data.depositAccountId === 'undefined', "Select  deposit account", errors  );  
}


// Function to Validate Item Table 
function validateItemTable(items, itemTable, errors) {
    // Check for item count mismatch
    validateField( items.length !== itemTable.length, "Mismatch in item count between request and database.", errors  );
    
    // Iterate through each item to validate individual fields
    items.forEach((item) => {
      const fetchedItem = itemTable.find(it => it._id.toString() === item.itemId);
    
      // Check if item exists in the item table
      validateField( !fetchedItem, `Item with ID ${item.itemId} was not found.`, errors );
      if (!fetchedItem) return; 
    
      // Validate item name
      validateField( item.itemName !== fetchedItem.itemName, `Item Name Mismatch : ${item.itemName}`, errors );
    
      // Validate cost price
      // validateField( item.itemCostPrice !== fetchedItem.costPrice, `Cost price Mismatch for ${item.itemName}:  ${item.itemCostPrice}`, errors );
    
      // Validate CGST
      validateField( item.itemCgst !== fetchedItem.cgst, `CGST Mismatch for ${item.itemName}: ${item.itemCgst}`, errors );
    
      // Validate SGST
      validateField( item.itemSgst !== fetchedItem.sgst, `SGST Mismatch for ${item.itemName}: ${item.itemSgst}`, errors );
    
      // Validate IGST
      validateField( item.itemIgst !== fetchedItem.igst, `IGST Mismatch for ${item.itemName}: ${item.itemIgst}`, errors );
    
      // Validate tax preference
      validateField( item.taxPreference !== fetchedItem.taxPreference, `Tax Preference mismatch for ${item.itemName}: ${item.taxPreference}`, errors );
    
      // Validate discount type
      // validateItemDiscountType(item.itemDiscountType, errors);
    
      // Validate integer fields
      validateIntegerFields(['itemQuantity'], item, errors);
    
      // Validate Stock Count 
      // validateField( item.itemQuantity > fetchedItem.currentStock, `Insufficient Stock for ${item.itemName}: Requested quantity ${item.itemQuantity}, Available stock ${fetchedItem.currentStock}`, errors );
    
      // Validate float fields
      validateFloatFields(['itemCostPrice', 'itemTotalTax', 'itemAmount'], item, errors);
    });
}



  // validate invoice data
function validateBillData(data, items, billExist, existingDebitNoteItems, errors) {  

  // const existingItem = existingDebitNoteItems[0].stock;
  
  // Initialize `billExist.items` to an empty array if undefined
  billExist.items = Array.isArray(billExist.items) ? billExist.items : [];

  // Validate basic fields
  validateField( billExist.billDate !== data.billDate, `Bill Date mismatch for ${billExist.billDate}`, errors  );
  validateField( billExist.orderNumber !== data.orderNumber, `Order Number mismatch for ${billExist.orderNumber}`, errors  );

  // Validate only the items included in the debit note
  items.forEach(dNItem => {
    const billItem = billExist.items.find(dataItem => dataItem.itemId.toString() === dNItem.itemId.toString());

    if (!billItem) {
      errors.push(`Item ID ${dNItem.itemId} not found in provided bills.`);
    } else {
        validateField(dNItem.itemCostPrice !== billItem.itemCostPrice, `Item Cost Price mismatch for ${billItem.itemId}: Expected ${billItem.itemCostPrice}, got ${dNItem.itemCostPrice}`, errors);

        validateField(dNItem.itemCgst !== billItem.itemCgst, `Item CGST mismatch for ${billItem.itemId}: Expected ${billItem.itemCgst}, got ${dNItem.itemCgst}`, errors);
        
        validateField(dNItem.itemSgst !== billItem.itemSgst, `Item SGST mismatch for ${billItem.itemId}: Expected ${billItem.itemSgst}, got ${dNItem.itemSgst}`, errors);
        
        validateField(dNItem.itemIgst !== billItem.itemIgst, `Item IGST mismatch for ${billItem.itemId}: Expected ${billItem.itemIgst}, got ${dNItem.itemIgst}`, errors);
        
        validateField(dNItem.itemQuantity > billItem.itemQuantity, `Provided quantity (${dNItem.itemQuantity}) cannot exceed bill items quantity (${billItem.itemQuantity}).`, errors);
        
        validateField(dNItem.itemQuantity <= 0, `Quantity must be greater than 0 for item ${dNItem.itemId}.`, errors);
        
        validateField(dNItem.itemQuantity > dNItem.stock, `Provided quantity (${dNItem.itemQuantity}) cannot exceed stock available (${dNItem.stock}) for item ${dNItem.itemId}.`, errors);
      }
  });

}



// Validate source Of Supply
function validateSourceOfSupply(sourceOfSupply, organization, errors) {
    validateField(
      sourceOfSupply && !validCountries[organization.organizationCountry]?.includes(sourceOfSupply),
      "Invalid Source of Supply: " + sourceOfSupply, errors );
}
  
// Validate destination Of Supply
function validateDestinationOfSupply(destinationOfSupply, organization, errors) {
    validateField(
      destinationOfSupply && !validCountries[organization.organizationCountry]?.includes(destinationOfSupply),
      "Invalid Destination of Supply: " + destinationOfSupply, errors );
}

// Validate Bill Type
function validateBillType(billType, errors) {
    validateField(
      billType && !validBillType.includes(billType),
      "Invalid Bill Type: " + billType, errors );
}

// Validate Payment Mode
function validatePaymentMode(paymentMode, errors) {
  validateField(
    paymentMode && !validation.validPaymentMode.includes(paymentMode),
    "Invalid Payment Mode: " + paymentMode, errors );
}



//Valid Alphanumeric Fields
function validateAlphanumericFields(fields, data, errors) {
    fields.forEach((field) => {
      validateField(data[field] && !isAlphanumeric(data[field]), "Invalid " + field + ": " + data[field], errors);
    });
  }
  // Validate Integer Fields
  function validateIntegerFields(fields, data, errors) {
  fields.forEach(field => {
    validateField(data[field] && !isInteger(data[field]), `Invalid ${field}: ${data[field]}`, errors);
  });
  }
  //Valid Float Fields  
  function validateFloatFields(fields, data, errors) {
    fields.forEach((balance) => {
      validateField(data[balance] && !isFloat(data[balance]),
        "Invalid " + balance.replace(/([A-Z])/g, " $1") + ": " + data[balance], errors);
    });
  }
  //Valid Alphabets Fields 
  function validateAlphabetsFields(fields, data, errors) {
    fields.forEach((field) => {
      if (data[field] !== undefined) {
        validateField(!isAlphabets(data[field]),
          field.charAt(0).toUpperCase() + field.slice(1) + " should contain only alphabets.", errors);
      }
    });
  }



// Helper functions to handle formatting
function capitalize(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
  }
  
  function formatCamelCase(word) {
  return word.replace(/([A-Z])/g, " $1");
  }
  
  // Validation helpers
  function isAlphabets(value) {
  return /^[A-Za-z\s]+$/.test(value);
  }
  
  function isFloat(value) {
  return /^-?\d+(\.\d+)?$/.test(value);
  }
  
  function isInteger(value) {
  return /^\d+$/.test(value);
  }
  
  function isAlphanumeric(value) {
  return /^[A-Za-z0-9]+$/.test(value);
  }
  
  function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }














  

  // Item Track Function
  async function itemTrack( savedDebitNote, itemTable, organizationId, debitId ) {

    // Fetch existing itemTrack entries
    const existingItemTracks = await ItemTrack.find({ organizationId, operationId: debitId });
    
    const createdDateTime = existingItemTracks[0] ? existingItemTracks[0].createdDateTime : null; 

    const { items } = savedDebitNote;

    for (const item of items) {
        const matchingItem = itemTable.find((entry) => entry._id.toString() === item.itemId.toString());

        if (!matchingItem) {
            console.error(`Item with ID ${item.itemId} not found in itemTable`);
            continue; 
        }  
  
  
      // Create a new entry for item tracking
      const newTrialEntry = new ItemTrack({
        organizationId: savedDebitNote.organizationId,
        operationId: savedDebitNote._id,
        transactionId: savedDebitNote.debitNote,
        action: "Debit Note",
        date: savedDebitNote.supplierDebitDate,
        itemId: matchingItem._id,
        sellingPrice: matchingItem.itemSellingPrice || 0,
        costPrice: matchingItem.itemCostPrice || 0, 
        creditQuantity: item.itemQuantity, 
        remark: `Sold to ${savedDebitNote.supplierDisplayName}`,
        createdDateTime: createdDateTime // Preserve the original createdDateTime
      });  

      await newTrialEntry.save();

      // Delete existing itemTrack entries for the operation
      if (existingItemTracks.length > 0) {
        await ItemTrack.deleteMany({ organizationId, operationId: debitId });
        console.log(`Deleted existing itemTrack entries for operationId: ${debitId}`);
      }
  
    }
  }











  async function journal( savedDebitNote, defAcc, supplierAccount, depositAccount ) {  

    // Fetch existing TrialBalance's createdDateTime
    const existingTrialBalance = await TrialBalance.findOne({
      organizationId: savedDebitNote.organizationId,
      operationId: savedDebitNote._id,
    });  

    const createdDateTime = existingTrialBalance ? existingTrialBalance.createdDateTime : null;

    // If there are existing entries, delete them
    if (existingTrialBalance) {
      await TrialBalance.deleteMany({
        organizationId: savedDebitNote.organizationId,
        operationId: savedDebitNote._id,
      });
      console.log(`Deleted existing TrialBalance entries for operationId: ${savedDebitNote._id}`);
    }

    const cgst = {
        organizationId: savedDebitNote.organizationId,
        operationId: savedDebitNote._id,
        transactionId: savedDebitNote.billNumber,
        date: savedDebitNote.createdDate,
        accountId: defAcc.inputCgst || undefined,
        action: "Purchase Return",
        debitAmount:  0,
        creditAmount: savedDebitNote.cgst || 0,
        remark: savedDebitNote.note,
      };
      const sgst = {
        organizationId: savedDebitNote.organizationId,
        operationId: savedDebitNote._id,
        transactionId: savedDebitNote.billNumber,
        date: savedDebitNote.createdDate,
        accountId: defAcc.inputSgst || undefined,
        action: "Purchase Return",
        debitAmount: 0,
        creditAmount: savedDebitNote.sgst || 0,
        remark: savedDebitNote.note,
      };
      const igst = {
        organizationId: savedDebitNote.organizationId,
        operationId: savedDebitNote._id,
        transactionId: savedDebitNote.billNumber,
        date: savedDebitNote.createdDate,
        accountId: defAcc.inputIgst || undefined,
        action: "Purchase Return",
        debitAmount: 0,
        creditAmount: savedDebitNote.igst || 0,
        remark: savedDebitNote.note,
      };
      const vat = {
        organizationId: savedDebitNote.organizationId,
        operationId: savedDebitNote._id,
        transactionId: savedDebitNote.billNumber,
        date: savedDebitNote.createdDate,
        accountId: defAcc.inputVat || undefined,
        action: "Purchase Return",
        debitAmount: 0,
        creditAmount: savedDebitNote.vat || 0,
        remark: savedDebitNote.note,
      };
      const supplierCredit = {
        organizationId: savedDebitNote.organizationId,
        operationId: savedDebitNote._id,
        transactionId: savedDebitNote.billNumber,
        date: savedDebitNote.createdDate,
        accountId: supplierAccount._id || undefined,
        action: "Purchase Return",
        debitAmount: savedDebitNote.grandTotal || 0,
        creditAmount:  0,
        remark: savedDebitNote.note,
      };
      const supplierReceived = {
        organizationId: savedDebitNote.organizationId,
        operationId: savedDebitNote._id,
        transactionId: savedDebitNote.billNumber,
        date: savedDebitNote.createdDate,
        accountId: supplierAccount._id || undefined,
        action: "Debit Note",
        debitAmount: 0,
        creditAmount: savedDebitNote.grandTotal || 0,
        remark: savedDebitNote.note,
      };
      const depositAccounts = {
        organizationId: savedDebitNote.organizationId,
        operationId: savedDebitNote._id,
        transactionId: savedDebitNote.billNumber,
        date: savedDebitNote.createdDate,
        accountId: depositAccount._id || undefined,
        action: "Debit Note",
        debitAmount: savedDebitNote.grandTotal || 0,
        creditAmount: 0,
        remark: savedDebitNote.note,
      };
  
      let purchaseTotalDebit = 0;
      let purchaseTotalCredit = 0;
    
      if (Array.isArray(savedDebitNote.purchaseJournal)) {
        savedDebitNote.purchaseJournal.forEach((entry) => {
    
          console.log( "Account Log",entry.accountId, entry.debitAmount, entry.creditAmount );      
    
          purchaseTotalDebit += entry.debitAmount || 0;
          purchaseTotalCredit += entry.creditAmount || 0;
    
        });
    
        console.log("Total Debit Amount from savedDebitNote:", purchaseTotalDebit);
        console.log("Total Credit Amount from savedDebitNote:", purchaseTotalCredit);
      } else {
        console.error("SavedDebitNote is not an array or is undefined.");
      }
    
  
      console.log("cgst", cgst.debitAmount,  cgst.creditAmount);
      console.log("sgst", sgst.debitAmount,  sgst.creditAmount);
      console.log("igst", igst.debitAmount,  igst.creditAmount);
      console.log("vat", vat.debitAmount,  vat.creditAmount);
    
      console.log("supplierCredit", supplierCredit.debitAmount,  supplierCredit.creditAmount);
      console.log("supplierReceived", supplierReceived.debitAmount,  supplierReceived.creditAmount);
      
      console.log("depositAccounts", depositAccounts.debitAmount,  depositAccounts.creditAmount);
    
      // const  debitAmount = cgst.debitAmount  + sgst.debitAmount + igst.debitAmount +  vat.debitAmount + purchase.debitAmount + supplier.debitAmount + discount.debitAmount + otherExpense.debitAmount + freight.debitAmount + roundOff.debitAmount + supplierPaid.debitAmount + paidAccount.debitAmount ;
      // const  creditAmount = cgst.creditAmount  + sgst.creditAmount + igst.creditAmount +  vat.creditAmount + purchase.creditAmount + supplier.creditAmount + discount.creditAmount + otherExpense.creditAmount + freight.creditAmount + roundOff.creditAmount + supplierPaid.creditAmount + paidAccount.creditAmount ;
    

      const debitAmount = 
      cgst.debitAmount  + 
      sgst.debitAmount  + 
      igst.debitAmount  + 
      vat.debitAmount  + 
      supplierCredit.debitAmount  + 
      depositAccounts.debitAmount  + 
      purchaseTotalDebit ;


      const creditAmount = 
      cgst.creditAmount  + 
      sgst.creditAmount  + 
      igst.creditAmount  + 
      vat.creditAmount  + 
      purchaseTotalCredit  + 
      supplierReceived.creditAmount  + 
      depositAccounts.creditAmount ;

      console.log("Total Debit Amount: ", debitAmount );
      console.log("Total Credit Amount: ", creditAmount );

      // console.log( discount, sale, cgst, sgst, igst, vat, customer, otherExpense, freight, roundOff );

  
      //Purchase
      savedDebitNote.purchaseJournal.forEach((entry) => {
  
        const data = {
            organizationId: savedDebitNote.organizationId,
            operationId: savedDebitNote._id,
            transactionId: savedDebitNote.billNumber,
            date: savedDebitNote.createdDate,
            accountId: entry.accountId || undefined,
            action: "Purchase Return",
            debitAmount: entry.debitAmount || 0,
            creditAmount: 0,
            remark: savedDebitNote.note,
        };
        
        createTrialEntry( data, createdDateTime )
  
      });
  
      
   
  
  
  
    //Tax
    if(savedDebitNote.cgst){
      createTrialEntry( cgst, createdDateTime )
    }
    if(savedDebitNote.sgst){
      createTrialEntry( sgst, createdDateTime )
    }
    if(savedDebitNote.igst){
      createTrialEntry( igst, createdDateTime )
    }
    if(savedDebitNote.vat){
      createTrialEntry( vat, createdDateTime )
    }
  
  //Paid
  if(savedDebitNote.grandTotal){
    createTrialEntry( supplierReceived, createdDateTime )
    createTrialEntry( depositAccounts, createdDateTime )
  }
}
  
  async function createTrialEntry( data, createdDateTime ) {
    const newTrialEntry = new TrialBalance({
        organizationId:data.organizationId,
        operationId:data.operationId,
        transactionId: data.transactionId,
        date:data.date,
        accountId: data.accountId,
        action: data.action,
        debitAmount: data.debitAmount,
        creditAmount: data.creditAmount,
        remark: data.remark,
        createdDateTime: createdDateTime
  });
  await newTrialEntry.save();
  }